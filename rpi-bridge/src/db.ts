import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

/**
 * SQLite の既定の置き場所。
 * `/tmp` は tmpfs なら再起動で消え、実ディスクでも systemd-tmpfiles により
 * 10日でクリーンアップされるため、会話履歴の保存先としては使えない。
 * XDG のデータディレクトリ（既定 ~/.local/share）配下に永続化する。
 */
const DEFAULT_DB_PATH = path.join(
  process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"),
  "rotom",
  "conversations.db",
);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Discord チャンネル会話の保持期間（30分）。
 * チャンネルは不特定多数が使うため、短時間で文脈を切る。
 */
export const SESSION_TTL_MS = 30 * 60 * 1000;

/**
 * Web チャットの保持期間（既定 30日）。
 * 家族が「前に聞いた会話の続き」を後日たどれるよう、Discord より大幅に長くする。
 * WEB_SESSION_TTL_DAYS で変更可能。
 */
function resolveWebTtlDays(): number {
  const raw = Number(process.env.WEB_SESSION_TTL_DAYS ?? 30);
  if (!Number.isFinite(raw) || raw <= 0) {
    console.warn(`[db] WEB_SESSION_TTL_DAYS が不正なため既定値 30 を使用します: ${process.env.WEB_SESSION_TTL_DAYS}`);
    return 30;
  }
  return raw;
}

export const WEB_SESSION_TTL_DAYS = resolveWebTtlDays();
export const WEB_SESSION_TTL_MS = WEB_SESSION_TTL_DAYS * DAY_MS;

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = process.env.DATABASE_PATH ?? DEFAULT_DB_PATH;

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // 既存テーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      session_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      guild_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES conversations(session_id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant', 'tool')),
      content TEXT,
      tool_calls_json TEXT,
      tool_call_id TEXT,
      model TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES conversations(session_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_channel_id ON conversations(channel_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_expires_at ON conversations(expires_at);
  `);

  // マイグレーション: conversations に user_id, session_name カラム追加（Web用）
  migrateConversationsTable();

  // マイグレーション: messages に model カラム追加（ADR-0016）
  migrateMessagesTable();

  // Web用テーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      display_name TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_prompts (
      user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
      prompt_text TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // マイグレーション: users に avatar, mode カラム追加
  migrateUsersTable();

  // 育成論取り込み（ADR-0013）。URL をキーにしたキャッシュで、
  // 構造化ヘッダが取れないページでも考察本文は必ず残す
  db.exec(`
    CREATE TABLE IF NOT EXISTS theory_refs (
      url TEXT PRIMARY KEY,
      pokemon TEXT,
      title TEXT,
      nature TEXT,
      ability TEXT,
      item TEXT,
      evs_json TEXT,
      moves_json TEXT,
      rule TEXT,
      role TEXT,
      body_text TEXT,
      fetched_at INTEGER NOT NULL
    );
  `);

  // 対戦振り返りの記録（ADR-0017）。matchId をキーに検品済みの振り返りを残す。
  // 原文（review_text）を必ず残し、改善候補・次の一手はベストエフォートで抜き出す
  db.exec(`
    CREATE TABLE IF NOT EXISTS match_reviews (
      match_id TEXT PRIMARY KEY,
      review_text TEXT NOT NULL,
      improvements TEXT,
      next_action TEXT,
      reviewed_at INTEGER NOT NULL
    );
  `);

  console.log(`[db] SQLite 初期化完了: ${dbPath}`);
  return db;
}

function migrateConversationsTable(): void {
  const d = db!;

  const existing = d.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>;
  const columnNames = new Set(existing.map((c) => c.name));

  if (!columnNames.has("user_id")) {
    d.exec("ALTER TABLE conversations ADD COLUMN user_id TEXT");
    console.log("[db] マイグレーション: conversations.user_id カラム追加");
  }
  if (!columnNames.has("session_name")) {
    d.exec("ALTER TABLE conversations ADD COLUMN session_name TEXT");
    console.log("[db] マイグレーション: conversations.session_name カラム追加");
  }

  // Web用インデックス（なければ作成）
  d.exec("CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id)");

  extendWebSessionExpiry();
}

/**
 * 旧仕様（30分TTL）で作られた Web セッションの期限を新しい保持期間へ引き延ばす。
 * これを行わないと、TTL を延ばした直後の起動で既存の履歴がまとめて削除されてしまう。
 * 条件付き UPDATE なので毎回実行しても安全。
 */
function extendWebSessionExpiry(): void {
  const d = db!;

  const result = d.prepare(
    `UPDATE conversations
        SET expires_at = updated_at + ?
      WHERE session_id LIKE 'user:%'
        AND expires_at < updated_at + ?`,
  ).run(WEB_SESSION_TTL_MS, WEB_SESSION_TTL_MS);

  if (result.changes > 0) {
    console.log(`[db] マイグレーション: Webセッション ${result.changes} 件の保持期間を ${WEB_SESSION_TTL_DAYS} 日へ延長`);
  }
}

function migrateMessagesTable(): void {
  const d = db!;

  const existing = d.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>;
  const columnNames = new Set(existing.map((c) => c.name));

  // 回答を生成したモデル ID（ADR-0016）。過去分は NULL のまま
  if (!columnNames.has("model")) {
    d.exec("ALTER TABLE messages ADD COLUMN model TEXT");
    console.log("[db] マイグレーション: messages.model カラム追加");
  }
}

function migrateUsersTable(): void {
  const d = db!;

  const existing = d.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  const columnNames = new Set(existing.map((c) => c.name));

  // アバター画像のキー（public/img/avatars/<avatar>.png）
  if (!columnNames.has("avatar")) {
    d.exec("ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT 'pikachu-face'");
    console.log("[db] マイグレーション: users.avatar カラム追加");
  }
  // 表示モード: kids（低学年向け・ひらがな中心） / junior（高学年〜大人向け）
  if (!columnNames.has("mode")) {
    d.exec("ALTER TABLE users ADD COLUMN mode TEXT NOT NULL DEFAULT 'kids'");
    console.log("[db] マイグレーション: users.mode カラム追加");
  }
  // 利用者別モデル（ADR-0015）。NULL は既定に従う
  if (!columnNames.has("model")) {
    d.exec("ALTER TABLE users ADD COLUMN model TEXT");
    console.log("[db] マイグレーション: users.model カラム追加");
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    console.log("[db] SQLite 接続を閉じました");
  }
}

import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const DEFAULT_DB_PATH = "/tmp/rotom-conversations.db";

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
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES conversations(session_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_channel_id ON conversations(channel_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_expires_at ON conversations(expires_at);
  `);

  // マイグレーション: conversations に user_id, session_name カラム追加（Web用）
  migrateConversationsTable();

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
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    console.log("[db] SQLite 接続を閉じました");
  }
}

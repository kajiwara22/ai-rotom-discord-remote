import type { ChatMessage, ConversationSession, SessionInfo, UserInfo, UserMode } from "./types.js";
import { getSystemPrompt, DISCORD_RESTRICTIONS } from "./tool-definitions.js";
import { getDb, SESSION_TTL_MS, WEB_SESSION_TTL_MS } from "./db.js";
import crypto from "node:crypto";
/**
 * LLM へ渡す会話履歴（user / assistant のテキスト）の上限。
 * ツール往復はこの数に含めない。role を問わず数えていた頃は、ツールを
 * 8 回呼ぶだけで枠が埋まり、実質 1〜2 往復しか記憶が残らなかった。
 * 詳しくは docs/adr/ADR-0006.md を参照。
 */
const MAX_CONVERSATION_MESSAGES = 20;

function sessionId(channelId: string): string {
  return `channel:${channelId}`;
}

export function getOrCreateSession(channelId: string, guildId?: string): ConversationSession {
  const db = getDb();
  const sid = sessionId(channelId);
  const now = Date.now();

  const row = db.prepare(
    "SELECT session_id, channel_id, guild_id, created_at, updated_at, expires_at, is_active FROM conversations WHERE session_id = ?",
  ).get(sid) as Record<string, unknown> | undefined;

  if (row) {
    const newExpiresAt = now + SESSION_TTL_MS;
    db.prepare(
      "UPDATE conversations SET updated_at = ?, expires_at = ?, is_active = 1 WHERE session_id = ?",
    ).run(now, newExpiresAt, sid);

    return {
      sessionId: row.session_id as string,
      channelId: row.channel_id as string,
      guildId: (row.guild_id as string) ?? null,
      createdAt: row.created_at as number,
      updatedAt: now,
      expiresAt: newExpiresAt,
      isActive: true,
    };
  }

  const expiresAt = now + SESSION_TTL_MS;
  db.prepare(
    "INSERT INTO conversations (session_id, channel_id, guild_id, created_at, updated_at, expires_at, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)",
  ).run(sid, channelId, guildId ?? null, now, now, expiresAt);

  console.log(`[conversation] 新規セッション作成: ${sid}`);

  return {
    sessionId: sid,
    channelId,
    guildId: guildId ?? null,
    createdAt: now,
    updatedAt: now,
    expiresAt,
    isActive: true,
  };
}

export function loadMessages(sessionIdStr: string): ChatMessage[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT role, content, tool_call_id, tool_calls_json FROM messages WHERE session_id = ? ORDER BY id ASC",
  ).all(sessionIdStr) as Array<{
    role: string;
    content: string | null;
    tool_call_id: string | null;
    tool_calls_json: string | null;
  }>;

  return rows.map((row) => {
    const msg: ChatMessage = {
      role: row.role as ChatMessage["role"],
      content: row.content,
    };
    if (row.tool_call_id) msg.tool_call_id = row.tool_call_id;
    if (row.tool_calls_json) msg.tool_calls = JSON.parse(row.tool_calls_json);
    return msg;
  });
}

export function saveMessages(sessionIdStr: string, messages: ChatMessage[]): void {
  const db = getDb();
  const now = Date.now();

  db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionIdStr);

  const insert = db.prepare(
    "INSERT INTO messages (session_id, role, content, tool_call_id, tool_calls_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );

  // ツール結果は tool-result-formatter.ts で整形済みのため、ここでは切り詰めない
  const insertMany = db.transaction((msgs: ChatMessage[]) => {
    for (const msg of msgs) {
      insert.run(
        sessionIdStr,
        msg.role,
        msg.content,
        msg.tool_call_id ?? null,
        msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
        now,
      );
    }
  });

  insertMany(messages);
}

export function deleteExpiredSessions(): number {
  const db = getDb();
  const now = Date.now();
  const result = db.prepare(
    "DELETE FROM conversations WHERE expires_at < ?",
  ).run(now);
  console.log(`[conversation] 期限切れセッション削除: ${result.changes}件`);
  return result.changes;
}

export function resetSession(channelId: string): void {
  const db = getDb();
  const sid = sessionId(channelId);
  db.prepare("DELETE FROM messages WHERE session_id = ?").run(sid);
  db.prepare("DELETE FROM conversations WHERE session_id = ?").run(sid);
  console.log(`[conversation] セッションリセット: ${sid}`);
}

/**
 * 先頭に残った孤立した role:"tool" を取り除く。
 *
 * OpenAI 互換 API では role:"tool" の直前に tool_calls を持つ assistant が
 * 必要で、履歴を件数で切り詰めるとこのペアが分断されて 400 になる。
 * 切断位置が tool の途中に来た場合は、その tool 群をまとめて捨てる。
 */
function dropOrphanToolMessages(messages: ChatMessage[]): ChatMessage[] {
  let start = 0;
  while (start < messages.length && messages[start].role === "tool") {
    start++;
  }
  return start === 0 ? messages : messages.slice(start);
}

/**
 * 履歴を役割別に絞る。
 *
 * 過去ターンのツール往復（role:"tool" と tool_calls 付き assistant）は落とし、
 * 会話として意味のある user / assistant のテキストだけを残す。過去に調べた
 * 数値は assistant の回答本文に含まれているため、生のツール結果を持ち回る
 * 価値は低い。
 *
 * 最後の user 以降（＝今回の質問）は件数上限に関係なく残す。中断などで
 * 未完のツール往復が DB に残っている場合、その断片は過去側として落ちる。
 */
function trimHistory(messages: ChatMessage[]): ChatMessage[] {
  const [systemMsg, ...rest] = messages;

  const lastUserIndex = rest.map((m) => m.role).lastIndexOf("user");
  const past = lastUserIndex < 0 ? rest : rest.slice(0, lastUserIndex);
  const current = lastUserIndex < 0 ? [] : rest.slice(lastUserIndex);

  const conversation = past.filter(
    (m) => m.role === "user" || (m.role === "assistant" && m.content && !m.tool_calls),
  );
  const kept = conversation.slice(-(MAX_CONVERSATION_MESSAGES - 1));

  // 既存 DB に壊れた履歴が残っているケースの保険。
  // system を除いた並びに適用する（先頭に system があると何も落とせない）
  return [systemMsg, ...dropOrphanToolMessages([...kept, ...current])];
}

export function prepareMessages(
  sessionIdStr: string,
  userMessage: string,
  systemPrompt: string,
): ChatMessage[] {
  const loaded = loadMessages(sessionIdStr);

  if (loaded.length === 0 || loaded[0].role !== "system") {
    loaded.unshift({ role: "system", content: systemPrompt });
  } else if (loaded[0].content !== systemPrompt) {
    // プロンプトが変更された場合は更新
    loaded[0] = { role: "system", content: systemPrompt };
  }

  loaded.push({ role: "user", content: userMessage });

  const messages = trimHistory(loaded);

  const totalChars = messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
  console.log(
    `[conversation] messages=${messages.length}/${loaded.length} totalChars=${totalChars}`,
  );

  return messages;
}

// ========== Web用セッション管理 ==========

export function resolveWebSessionId(rawId: string): string | null {
  const db = getDb();
  const row = db.prepare(
    "SELECT session_id FROM conversations WHERE session_id LIKE '%:session:' || ?",
  ).get(rawId) as { session_id: string } | undefined;
  return row?.session_id ?? null;
}

function webSessionId(userId: string, sessionId: string): string {
  return `user:${userId}:session:${sessionId}`;
}

const DEFAULT_AVATAR = "pikachu-face";
const DEFAULT_MODE: UserMode = "kids";

function normalizeMode(value: unknown): UserMode {
  return value === "junior" ? "junior" : "kids";
}

function rowToUser(row: Record<string, unknown>): UserInfo {
  return {
    user_id: row.user_id as string,
    display_name: (row.display_name as string) ?? (row.user_id as string),
    created_at: row.created_at as number,
    avatar: (row.avatar as string) || DEFAULT_AVATAR,
    mode: normalizeMode(row.mode),
  };
}

export function ensureUser(
  userId: string,
  displayName?: string,
  avatar?: string,
  mode?: UserMode,
): UserInfo {
  const db = getDb();
  const now = Date.now();

  const row = db.prepare(
    "SELECT user_id, display_name, created_at, avatar, mode FROM users WHERE user_id = ?",
  ).get(userId) as Record<string, unknown> | undefined;

  if (row) {
    return rowToUser(row);
  }

  const newAvatar = avatar || DEFAULT_AVATAR;
  const newMode = mode ? normalizeMode(mode) : DEFAULT_MODE;

  db.prepare(
    "INSERT INTO users (user_id, display_name, created_at, avatar, mode) VALUES (?, ?, ?, ?, ?)",
  ).run(userId, displayName ?? userId, now, newAvatar, newMode);

  console.log(`[conversation] ユーザー自動作成: ${userId} (avatar=${newAvatar}, mode=${newMode})`);

  return {
    user_id: userId,
    display_name: displayName ?? userId,
    created_at: now,
    avatar: newAvatar,
    mode: newMode,
  };
}

export function getUsers(): UserInfo[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT user_id, display_name, created_at, avatar, mode FROM users ORDER BY created_at ASC",
  ).all() as Array<Record<string, unknown>>;

  return rows.map(rowToUser);
}

export function countUsers(): number {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  return row.n;
}

/**
 * ユーザーと、そのユーザーに紐づく会話・メッセージ・個別プロンプトを削除する。
 * messages は conversations への ON DELETE CASCADE で消えるが、
 * 意図を明示するため明示的にも削除している。
 */
export function deleteUser(userId: string): boolean {
  const db = getDb();
  if (!getUser(userId)) return false;

  const run = db.transaction(() => {
    const sessions = db.prepare(
      "SELECT session_id FROM conversations WHERE user_id = ?",
    ).all(userId) as Array<{ session_id: string }>;

    const delMessages = db.prepare("DELETE FROM messages WHERE session_id = ?");
    for (const s of sessions) {
      delMessages.run(s.session_id);
    }

    db.prepare("DELETE FROM conversations WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM system_prompts WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM users WHERE user_id = ?").run(userId);
  });

  run();
  console.log(`[conversation] ユーザー削除: ${userId}`);
  return true;
}

export function getUser(userId: string): UserInfo | null {
  const db = getDb();
  const row = db.prepare(
    "SELECT user_id, display_name, created_at, avatar, mode FROM users WHERE user_id = ?",
  ).get(userId) as Record<string, unknown> | undefined;

  return row ? rowToUser(row) : null;
}

/** 表示名・アバター・モードの部分更新 */
export function updateUser(
  userId: string,
  patch: { display_name?: string; avatar?: string; mode?: UserMode },
): UserInfo | null {
  const db = getDb();
  const current = getUser(userId);
  if (!current) return null;

  const next = {
    display_name: patch.display_name?.trim() || current.display_name,
    avatar: patch.avatar?.trim() || current.avatar,
    mode: patch.mode ? normalizeMode(patch.mode) : current.mode,
  };

  db.prepare(
    "UPDATE users SET display_name = ?, avatar = ?, mode = ? WHERE user_id = ?",
  ).run(next.display_name, next.avatar, next.mode, userId);

  console.log(`[conversation] ユーザー更新: ${userId} (avatar=${next.avatar}, mode=${next.mode})`);

  return { ...current, ...next };
}

export function getOrCreateWebSession(
  userId: string,
  sessionId?: string,
): ConversationSession {
  const db = getDb();
  const now = Date.now();

  if (sessionId) {
    const sid = webSessionId(userId, sessionId);
    const row = db.prepare(
      "SELECT session_id, channel_id, guild_id, created_at, updated_at, expires_at, is_active, user_id, session_name FROM conversations WHERE session_id = ? AND user_id = ?",
    ).get(sid, userId) as Record<string, unknown> | undefined;

    if (row) {
      // Web は Discord より長期（既定 30日）。アクセスのたびに期限を延長する
      const newExpiresAt = now + WEB_SESSION_TTL_MS;
      db.prepare(
        "UPDATE conversations SET updated_at = ?, expires_at = ?, is_active = 1 WHERE session_id = ?",
      ).run(now, newExpiresAt, sid);

      return {
        sessionId: row.session_id as string,
        channelId: row.channel_id as string,
        guildId: (row.guild_id as string) ?? null,
        createdAt: row.created_at as number,
        updatedAt: now,
        expiresAt: newExpiresAt,
        isActive: true,
      };
    }
  }

  const newSessionId = crypto.randomUUID();
  const sid = webSessionId(userId, newSessionId);
  const expiresAt = now + WEB_SESSION_TTL_MS;

  db.prepare(
    "INSERT INTO conversations (session_id, channel_id, guild_id, created_at, updated_at, expires_at, is_active, user_id, session_name) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)",
  ).run(sid, "", null, now, now, expiresAt, userId, "");

  console.log(`[conversation] Webセッション自動作成: ${sid}`);

  return {
    sessionId: sid,
    channelId: "",
    guildId: null,
    createdAt: now,
    updatedAt: now,
    expiresAt,
    isActive: true,
  };
}

export function getUserSessions(userId: string): SessionInfo[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT c.session_id, c.user_id, c.session_name, c.created_at, c.updated_at,
            (SELECT COUNT(*) FROM messages m WHERE m.session_id = c.session_id AND m.role IN ('user', 'assistant')) as message_count
     FROM conversations c
     WHERE c.user_id = ? AND c.session_id LIKE 'user:%'
     ORDER BY c.updated_at DESC`,
  ).all(userId) as Array<Record<string, unknown>>;

  return rows.map((r) => {
    const rawId = (r.session_id as string).includes(":session:")
      ? (r.session_id as string).slice((r.session_id as string).lastIndexOf(":session:") + 9)
      : (r.session_id as string);
    return {
      session_id: rawId,
      user_id: r.user_id as string,
      session_name: (r.session_name as string) || "",
      created_at: r.created_at as number,
      updated_at: r.updated_at as number,
      message_count: r.message_count as number,
    };
  });
}

export function renameWebSession(sessionId: string, name: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE conversations SET session_name = ? WHERE session_id = ?",
  ).run(name, sessionId);
}

export function resetWebSession(userId: string, sessionId: string): void {
  const db = getDb();
  const sid = webSessionId(userId, sessionId);
  db.prepare("DELETE FROM messages WHERE session_id = ?").run(sid);
  db.prepare("DELETE FROM conversations WHERE session_id = ?").run(sid);
  console.log(`[conversation] Webセッションリセット: ${sid}`);
}

/** モードごとの応答スタイル指示。UIの見た目だけでなく回答の難易度も合わせる */
const MODE_INSTRUCTIONS: Record<UserMode, string> = {
  kids: `

## 相手について
相手は小学校低学年の子どもです。次を必ず守ってください。
- ひらがなを多めに使い、むずかしい漢字は避ける
- 一文を短くする。専門用語は使う前にやさしく言いかえる
- 数値を並べるより、まず「つよい / よわい」など感覚でわかる説明をする
- 回答は 200 文字程度までにおさめる`,
  junior: `

## 相手について
相手は小学校高学年以上です。次を意識してください。
- 漢字を通常どおり使い、対戦用語もそのまま使ってよい
- 種族値・SP 調整・与ダメージなど具体的な数値を示す
- テーブルやリストを使って要点を整理する
- 回答は 1500 文字程度までにおさめる。収まらないときは重要な順に絞り、
  途中で力尽きるのではなく「続きが必要か」を最後に尋ねて区切る`,
};

/**
 * 3 択クイズの出題形式（ADR-0011）。Web UI 専用。
 *
 * 選択肢を押せる形で出すには、人が読む本文とは別に機械が読める構造が要る。
 * ブロックはサーバーが取り出して API の `quiz` に載せ、本文からは取り除く。
 *
 * 形式が守られなかった場合はブロックが本文として表示されるだけで、会話は止まらない。
 */
const QUIZ_INSTRUCTIONS = `

## 3 択クイズを求められたとき
1. 出題するポケモン・技・タイプの内容は、**必ずツールで確認してから**問題にする。
   確認できなかったことは出題しない
2. 一度に 5 問まとめて作る
3. 本文には短い前置きを 1 行だけ書く。**問題文と選択肢は本文に書かない**
   （下のブロックと二重に表示されてしまう）
4. 前置きのあとに、次の形式のブロックをちょうど 1 つ置く

\`\`\`quiz
{"questions":[{"question":"問題文","choices":["せんたくし1","せんたくし2","せんたくし3"],"answer":1,"explanation":"1〜2文の解説"}]}
\`\`\`

- \`choices\` はちょうど 3 つにする
- \`answer\` は正解の選択肢の番号（1 / 2 / 3）
- \`explanation\` は答え合わせのときに出す 1〜2 文の解説
- 正解の番号は問題ごとにばらけさせる
- 回答の文字数の目安は、このブロックには当てはまらない

クイズの成績が送られてきたら、まずほめて、間違えた問題だけ短く振り返る。
このとき、新しいクイズを求められていなければブロックは書かない。`;

/**
 * 設定画面で編集する対象のプロンプト。
 * モード指示は実行時に付与するため、ここには含めない。
 * これを含めて返すと、保存のたびにモード指示が本文へ焼き込まれて増殖する。
 */
export function getStoredSystemPrompt(userId: string): string {
  const db = getDb();
  const row = db.prepare(
    "SELECT prompt_text FROM system_prompts WHERE user_id = ?",
  ).get(userId) as { prompt_text: string } | undefined;

  return row && row.prompt_text ? row.prompt_text : getSystemPrompt();
}

/** AI 呼び出しに実際に渡すプロンプト（保存内容 + モード指示） */
export function getSystemPromptForUser(userId: string): string {
  const base = getStoredSystemPrompt(userId);

  if (userId === "__discord__") {
    return base + DISCORD_RESTRICTIONS;
  }

  // ユーザーの表示モードに応じた応答スタイル指示を付与する。
  // クイズは選択肢 UI を持つ Web UI 専用のため、Discord には付けない（ADR-0011）
  const user = getUser(userId);
  if (user) {
    return base + MODE_INSTRUCTIONS[user.mode] + QUIZ_INSTRUCTIONS;
  }
  return base + QUIZ_INSTRUCTIONS;
}

export function setSystemPromptForUser(userId: string, promptText: string): void {
  const db = getDb();
  const now = Date.now();

  db.prepare(
    "INSERT INTO system_prompts (user_id, prompt_text, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET prompt_text = ?, updated_at = ?",
  ).run(userId, promptText, now, promptText, now);

  console.log(`[conversation] システムプロンプト更新: user=${userId} (${promptText.length} chars)`);
}

export function updateSessionName(sessionId: string, name: string): void {
  renameWebSession(sessionId, name);
}

/**
 * Webセッションを完全に削除する。
 * user_id を必ず条件に含め、他ユーザーのセッションを消せないようにする。
 * @returns 削除できた場合 true
 */
export function deleteWebSession(userId: string, sessionId: string): boolean {
  const db = getDb();
  const sid = webSessionId(userId, sessionId);

  const owned = db.prepare(
    "SELECT 1 FROM conversations WHERE session_id = ? AND user_id = ?",
  ).get(sid, userId);

  if (!owned) {
    return false;
  }

  db.prepare("DELETE FROM messages WHERE session_id = ?").run(sid);
  db.prepare("DELETE FROM conversations WHERE session_id = ?").run(sid);
  console.log(`[conversation] Webセッション削除: ${sid}`);
  return true;
}

// ========== 保護者用 PIN ==========

const PIN_KEY = "parent_pin";

function getSetting(key: string): string | null {
  const db = getDb();
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row ? row.value : null;
}

function setSetting(key: string, value: string): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?",
  ).run(key, value, now, value, now);
}

/** PIN は salt 付き scrypt で保存する（平文では持たない） */
function hashPin(pin: string, salt: string): string {
  return crypto.scryptSync(pin, salt, 32).toString("hex");
}

export function isParentPinSet(): boolean {
  return getSetting(PIN_KEY) !== null;
}

export function setParentPin(pin: string): void {
  const salt = crypto.randomBytes(16).toString("hex");
  setSetting(PIN_KEY, `${salt}:${hashPin(pin, salt)}`);
  console.log("[conversation] 保護者PINを更新しました");
}

export function verifyParentPin(pin: string): boolean {
  const stored = getSetting(PIN_KEY);
  if (!stored) return false;

  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;

  const actual = hashPin(pin, salt);
  // タイミング攻撃対策のため定数時間比較を使う
  const a = Buffer.from(actual, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function getSessionMessages(sessionId: string): ChatMessage[] {
  return loadMessages(sessionId);
}

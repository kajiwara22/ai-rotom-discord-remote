import type { ChatMessage, ConversationSession, SessionInfo, UserInfo } from "./types.js";
import { getSystemPrompt, DISCORD_RESTRICTIONS } from "./tool-definitions.js";
import { getDb } from "./db.js";
import crypto from "node:crypto";

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_TOOL_RESULT = 2000;
const MAX_MESSAGES = 20;

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

  const insertMany = db.transaction((msgs: ChatMessage[]) => {
    for (const msg of msgs) {
      let content = msg.content;
      if (msg.role === "tool" && content && content.length > MAX_TOOL_RESULT) {
        content = content.slice(0, MAX_TOOL_RESULT) + "\n...(省略)";
      }
      insert.run(
        sessionIdStr,
        msg.role,
        content,
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

export function prepareMessages(
  sessionIdStr: string,
  userMessage: string,
  systemPrompt: string,
): ChatMessage[] {
  let messages = loadMessages(sessionIdStr);

  if (messages.length === 0 || messages[0].role !== "system") {
    messages.unshift({ role: "system", content: systemPrompt });
  } else if (messages[0].content !== systemPrompt) {
    // プロンプトが変更された場合は更新
    messages[0] = { role: "system", content: systemPrompt };
  }

  messages.push({ role: "user", content: userMessage });

  if (messages.length > MAX_MESSAGES) {
    const systemMsg = messages[0];
    messages = [systemMsg, ...messages.slice(-(MAX_MESSAGES - 1))];
  }

  const totalChars = messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
  console.log(`[conversation] messages=${messages.length} totalChars=${totalChars}`);

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

export function ensureUser(userId: string, displayName?: string): UserInfo {
  const db = getDb();
  const now = Date.now();

  const row = db.prepare(
    "SELECT user_id, display_name, created_at FROM users WHERE user_id = ?",
  ).get(userId) as Record<string, unknown> | undefined;

  if (row) {
    return {
      user_id: row.user_id as string,
      display_name: (row.display_name as string) ?? userId,
      created_at: row.created_at as number,
    };
  }

  db.prepare(
    "INSERT INTO users (user_id, display_name, created_at) VALUES (?, ?, ?)",
  ).run(userId, displayName ?? userId, now);

  console.log(`[conversation] ユーザー自動作成: ${userId}`);

  return { user_id: userId, display_name: displayName ?? userId, created_at: now };
}

export function getUsers(): UserInfo[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT user_id, display_name, created_at FROM users ORDER BY created_at ASC",
  ).all() as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    user_id: r.user_id as string,
    display_name: (r.display_name as string) ?? (r.user_id as string),
    created_at: r.created_at as number,
  }));
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
  }

  const newSessionId = crypto.randomUUID();
  const sid = webSessionId(userId, newSessionId);
  const expiresAt = now + SESSION_TTL_MS;

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

export function getSystemPromptForUser(userId: string): string {
  const db = getDb();
  const row = db.prepare(
    "SELECT prompt_text FROM system_prompts WHERE user_id = ?",
  ).get(userId) as { prompt_text: string } | undefined;

  if (row && row.prompt_text) {
    return row.prompt_text;
  }

  const base = getSystemPrompt();
  if (userId === "__discord__") {
    return base + DISCORD_RESTRICTIONS;
  }
  return base;
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

export function getSessionMessages(sessionId: string): ChatMessage[] {
  return loadMessages(sessionId);
}

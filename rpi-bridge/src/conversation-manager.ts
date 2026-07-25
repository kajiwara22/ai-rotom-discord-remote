import type { ChatMessage, ConversationSession } from "./types.js";
import { getDb } from "./db.js";

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

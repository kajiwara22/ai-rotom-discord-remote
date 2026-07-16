import { DurableObject } from "cloudflare:workers";
import type { ChatMessage } from "./types";
import { executeToolCallLoop } from "./ai";
import { TOOL_DEFINITIONS, getSystemPrompt } from "./tool-definitions";

const SESSION_TTL_MINUTES = 30;

export class ConversationSession extends DurableObject<Record<string, never>> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Record<string, never>) {
    super(ctx, env);
    this.sql = ctx.storage.sql;

    this.sql.exec(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      content TEXT,
      tool_call_id TEXT,
      tool_calls_json TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    )`);
  }

  private loadMessages(): ChatMessage[] {
    const rows = this.sql.exec("SELECT role, content, tool_call_id, tool_calls_json FROM messages ORDER BY id ASC");
    const messages: ChatMessage[] = [];
    for (const row of rows) {
      const msg: ChatMessage = {
        role: row.role as ChatMessage["role"],
        content: row.content as string | null,
      };
      if (row.tool_call_id) msg.tool_call_id = row.tool_call_id as string;
      if (row.tool_calls_json) msg.tool_calls = JSON.parse(row.tool_calls_json as string);
      messages.push(msg);
    }
    return messages;
  }

  private saveMessages(messages: ChatMessage[]): void {
    this.sql.exec("DELETE FROM messages");
    for (const msg of messages) {
      this.sql.exec(
        "INSERT INTO messages (role, content, tool_call_id, tool_calls_json) VALUES (?, ?, ?, ?)",
        msg.role,
        msg.content,
        msg.tool_call_id ?? null,
        msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
      );
    }
  }

  async ask(
    userMessage: string,
    apiKey: string,
    baseUrl: string,
    bridgeUrl: string,
    accessClientId: string,
    accessClientSecret: string,
    applicationId: string,
    interactionToken: string,
  ): Promise<void> {
    let messages = this.loadMessages();

    if (messages.length === 0) {
      messages.push({ role: "system", content: getSystemPrompt() });
    }

    messages.push({ role: "user", content: userMessage });

    if (messages.length > 22) {
      const systemMsg = messages[0];
      messages = [systemMsg, ...messages.slice(-20)];
    }

    try {
      const resultMessages = await executeToolCallLoop(
        messages,
        TOOL_DEFINITIONS,
        apiKey,
        baseUrl,
        async (toolName, args) => {
          const response = await fetch(`${bridgeUrl}/tools/${toolName}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "CF-Access-Client-Id": accessClientId,
              "CF-Access-Client-Secret": accessClientSecret,
            },
            body: JSON.stringify(args),
          });
          if (!response.ok) {
            return JSON.stringify({ success: false, error: `Bridge error: ${response.status}` });
          }
          const result = await response.json() as { success: boolean; result?: unknown; error?: string };
          return JSON.stringify(result.success ? result.result : { error: result.error });
        },
      );

      this.saveMessages(resultMessages);

      const lastAssistant = [...resultMessages].reverse().find((m) => m.role === "assistant" && m.content);
      const answer = lastAssistant?.content ?? "回答を生成できませんでした。";

      await fetch(
        `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: answer }),
        },
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "不明なエラー";
      await fetch(
        `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: `エラー: ${errorMsg}` }),
        },
      );
    }

    await this.ctx.storage.setAlarm(Date.now() + SESSION_TTL_MINUTES * 60 * 1000);
  }

  async reset(): Promise<void> {
    this.sql.exec("DELETE FROM messages");
    await this.ctx.storage.deleteAlarm();
  }

  async alarm(): Promise<void> {
    this.sql.exec("DELETE FROM messages");
  }
}

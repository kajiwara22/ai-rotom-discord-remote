import { DurableObject } from "cloudflare:workers";
import type { ChatMessage, PendingAsk } from "./types";
import { executeToolCallLoop } from "./ai";
import { TOOL_DEFINITIONS, getSystemPrompt } from "./tool-definitions";

const SESSION_TTL_MINUTES = 30;
const PENDING_ASK_KEY = "pendingAsk";
const MAX_TOOL_RESULT = 2000;
const MAX_MESSAGES = 16;

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
      let content = msg.content;
      if (msg.role === "tool" && content && content.length > MAX_TOOL_RESULT) {
        content = content.slice(0, MAX_TOOL_RESULT) + "\n...(省略)";
      }
      this.sql.exec(
        "INSERT INTO messages (role, content, tool_call_id, tool_calls_json) VALUES (?, ?, ?, ?)",
        msg.role,
        content,
        msg.tool_call_id ?? null,
        msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
      );
    }
  }

  async enqueueAsk(
    userMessage: string,
    apiKey: string,
    baseUrl: string,
    bridgeUrl: string,
    accessClientId: string,
    accessClientSecret: string,
    applicationId: string,
    interactionToken: string,
  ): Promise<void> {
    const pending: PendingAsk = {
      userMessage,
      apiKey,
      baseUrl,
      bridgeUrl,
      accessClientId,
      accessClientSecret,
      applicationId,
      interactionToken,
    };
    await this.ctx.storage.put(PENDING_ASK_KEY, pending);
    await this.ctx.storage.setAlarm(Date.now());
  }

  async reset(): Promise<void> {
    this.sql.exec("DELETE FROM messages");
    await this.ctx.storage.delete(PENDING_ASK_KEY);
    await this.ctx.storage.deleteAlarm();
  }

  async alarm(): Promise<void> {
    const pending = await this.ctx.storage.get<PendingAsk>(PENDING_ASK_KEY);

    if (pending) {
      await this.ctx.storage.delete(PENDING_ASK_KEY);
      await this.processAsk(pending);
      await this.ctx.storage.setAlarm(Date.now() + SESSION_TTL_MINUTES * 60 * 1000);
    } else {
      this.sql.exec("DELETE FROM messages");
    }
  }

  private async processAsk(pending: PendingAsk): Promise<void> {
    let messages = this.loadMessages();

    if (messages.length === 0) {
      messages.push({ role: "system", content: getSystemPrompt() });
    }

    messages.push({ role: "user", content: pending.userMessage });

    if (messages.length > MAX_MESSAGES) {
      const systemMsg = messages[0];
      messages = [systemMsg, ...messages.slice(-(MAX_MESSAGES - 1))];
    }

    const totalChars = messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
    console.log(`[processAsk] messages=${messages.length} totalChars=${totalChars}`);

    try {
      const resultMessages = await executeToolCallLoop(
        messages,
        TOOL_DEFINITIONS,
        pending.apiKey,
        pending.baseUrl,
        async (toolName, args) => {
          const response = await fetch(`${pending.bridgeUrl}/tools/${toolName}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "CF-Access-Client-Id": pending.accessClientId,
              "CF-Access-Client-Secret": pending.accessClientSecret,
            },
            body: JSON.stringify(args),
          });
          if (!response.ok) {
            return JSON.stringify({ success: false, error: `Bridge error: ${response.status}` });
          }
          const bridgeResult = await response.json() as {
            success: boolean;
            result?: { content?: Array<{ type: string; text?: string }> };
            error?: string;
          };
          if (!bridgeResult.success) {
            return JSON.stringify({ success: false, error: bridgeResult.error });
          }
          const text = bridgeResult.result?.content?.[0]?.text
            ?? JSON.stringify(bridgeResult.result);
          return text.length > MAX_TOOL_RESULT ? text.slice(0, MAX_TOOL_RESULT) + "\n...(省略)" : text;
        },
      );

      this.saveMessages(resultMessages);

      const lastAssistant = [...resultMessages].reverse().find((m) => m.role === "assistant" && m.content);
      const body = lastAssistant?.content ?? "回答を生成できませんでした。";
      const answer = `> ${pending.userMessage}\n${body}`;

      await fetch(
        `https://discord.com/api/v10/webhooks/${pending.applicationId}/${pending.interactionToken}/messages/@original`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: answer }),
        },
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "不明なエラー";
      await fetch(
        `https://discord.com/api/v10/webhooks/${pending.applicationId}/${pending.interactionToken}/messages/@original`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: `エラー: ${errorMsg}` }),
        },
      );
    }
  }
}

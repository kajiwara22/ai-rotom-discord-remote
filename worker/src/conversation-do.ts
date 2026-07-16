import { DurableObject } from "cloudflare:workers";
import type { ChatMessage, ToolDefinition } from "./types";
import { executeToolCallLoop } from "./ai";
import { TOOL_DEFINITIONS, getSystemPrompt } from "./tool-definitions";

const SESSION_TTL_MINUTES = 30;

export class ConversationSession extends DurableObject {
  private messages: ChatMessage[] = [];
  private currentProcessing: Promise<void> | null = null;

  async initialize(): Promise<void> {
    // システムメッセージのみ初期化
  }

  async ask(
    userMessage: string,
    apiKey: string,
    baseUrl: string,
    bridgeUrl: string,
    applicationId: string,
    interactionToken: string,
  ): Promise<void> {
    // 初回メッセージの場合、システムプロンプトを追加
    if (this.messages.length === 0) {
      this.messages.push({ role: "system", content: getSystemPrompt() });
    }

    this.messages.push({ role: "user", content: userMessage });

    // 上限を超えたら古いメッセージを切り捨て（システム+最新20件）
    if (this.messages.length > 22) {
      const systemMsg = this.messages[0];
      this.messages = [systemMsg, ...this.messages.slice(-20)];
    }

    try {
      const resultMessages = await executeToolCallLoop(
        this.messages,
        TOOL_DEFINITIONS as ToolDefinition[],
        apiKey,
        baseUrl,
        async (toolName, args) => {
          const response = await fetch(`${bridgeUrl}/tools/${toolName}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(args),
          });
          if (!response.ok) {
            return JSON.stringify({ success: false, error: `Bridge error: ${response.status}` });
          }
          const result = await response.json() as { success: boolean; result?: unknown; error?: string };
          return JSON.stringify(result.success ? result.result : { error: result.error });
        },
      );

      this.messages = resultMessages;

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

    // セッションTTLをリセット
    await this.ctx.storage.setAlarm(Date.now() + SESSION_TTL_MINUTES * 60 * 1000);
  }

  async reset(): Promise<void> {
    this.messages = [];
    await this.ctx.storage.deleteAlarm();
  }

  async alarm(): Promise<void> {
    // セッション期限切れ → 破棄
    this.messages = [];
  }
}

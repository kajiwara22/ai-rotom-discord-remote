import type { ChatMessage, ToolCall, ToolDefinition, OpenCodeGoResponse } from "./types.js";
import { TOOL_DEFINITIONS, getSystemPrompt } from "./tool-definitions.js";
import {
  getOrCreateSession,
  loadMessages,
  saveMessages,
  prepareMessages,
} from "./conversation-manager.js";
import { editOriginalResponse } from "./discord-webhook.js";

const MODEL = "deepseek-v4-pro";
const MAX_TOOL_CALLS = 30;
const MAX_TOOL_RESULT = 2000;

export async function chatCompletion(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  apiKey: string,
  baseUrl: string,
): Promise<{ content: string | null; toolCalls: ToolCall[]; finishReason: string }> {
  const payload = JSON.stringify({
    model: MODEL,
    messages,
    tools,
    tool_choice: "auto",
    max_tokens: 4096,
  });
  console.log(`[ai] chatCompletion payloadSize=${payload.length} messages=${messages.length}`);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: payload,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenCode Go API error (${response.status}): ${text}`);
  }

  const data = (await response.json()) as OpenCodeGoResponse;
  const choice = data.choices[0];
  const message = choice.message;

  return {
    content: message.content,
    toolCalls: message.tool_calls ?? [],
    finishReason: choice.finish_reason,
  };
}

export async function executeToolCallLoop(
  initialMessages: ChatMessage[],
  tools: ToolDefinition[],
  apiKey: string,
  baseUrl: string,
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>,
): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [...initialMessages];
  let loop = 0;

  while (loop < MAX_TOOL_CALLS) {
    const { content, toolCalls, finishReason } = await chatCompletion(
      messages,
      tools,
      apiKey,
      baseUrl,
    );

    if (finishReason === "stop") {
      if (content) {
        messages.push({ role: "assistant", content });
      }
      return messages;
    }

    if (toolCalls.length === 0) {
      if (content) {
        messages.push({ role: "assistant", content });
      }
      return messages;
    }

    messages.push({
      role: "assistant",
      content: content,
      tool_calls: toolCalls,
    });

    for (const toolCall of toolCalls) {
      const functionName = toolCall.function.name;
      let functionArgs: Record<string, unknown>;
      try {
        functionArgs = JSON.parse(toolCall.function.arguments);
      } catch {
        functionArgs = {};
      }

      console.log(`[ai] ツール実行: ${functionName} (loop=${loop})`);
      const result = await executeTool(functionName, functionArgs);

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result.length > MAX_TOOL_RESULT
          ? result.slice(0, MAX_TOOL_RESULT) + "\n...(省略)"
          : result,
      });
    }

    loop++;
  }

  console.log(`[ai] ツール呼び出し上限到達 (${MAX_TOOL_CALLS}回)`);
  return messages;
}

export interface AskContext {
  channelId: string;
  guildId?: string;
  applicationId: string;
  interactionToken: string;
  apiKey: string;
  baseUrl: string;
  bridgeUrl: string;
}

export async function runAsk(
  userMessage: string,
  ctx: AskContext,
): Promise<{ success: boolean; error?: string }> {
  const session = getOrCreateSession(ctx.channelId, ctx.guildId);

  const messages = prepareMessages(session.sessionId, userMessage, getSystemPrompt());

  try {
    const resultMessages = await executeToolCallLoop(
      messages,
      TOOL_DEFINITIONS,
      ctx.apiKey,
      ctx.baseUrl,
      async (toolName, args) => {
        const response = await fetch(`${ctx.bridgeUrl}/tools/${toolName}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args),
        });
        if (!response.ok) {
          return JSON.stringify({ success: false, error: `Bridge error: ${response.status}` });
        }
        const bridgeResult = (await response.json()) as {
          success: boolean;
          result?: { content?: Array<{ type: string; text?: string }> };
          error?: string;
        };
        if (!bridgeResult.success) {
          return JSON.stringify({ success: false, error: bridgeResult.error });
        }
        const text = bridgeResult.result?.content?.[0]?.text
          ?? JSON.stringify(bridgeResult.result);
        return text;
      },
    );

    saveMessages(session.sessionId, resultMessages);

    const lastAssistant = [...resultMessages]
      .reverse()
      .find((m) => m.role === "assistant" && m.content);
    const body = lastAssistant?.content ?? "回答を生成できませんでした。";
    const answer = `> ${userMessage}\n${body}`;

    await editOriginalResponse(ctx.applicationId, ctx.interactionToken, answer);
    console.log(`[ai] 応答送信完了: channel=${ctx.channelId}`);

    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "不明なエラー";
    console.error(`[ai] 処理エラー: ${errorMsg}`);

    try {
      await editOriginalResponse(
        ctx.applicationId,
        ctx.interactionToken,
        `> ${userMessage}\nエラーが発生しました: ${errorMsg}`,
      );
    } catch (webhookError) {
      console.error("[ai] Webhook エラー通知失敗:", webhookError);
    }

    return { success: false, error: errorMsg };
  }
}

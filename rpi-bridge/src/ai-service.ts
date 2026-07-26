import type { ChatMessage, ToolCall, ToolDefinition, OpenCodeGoResponse } from "./types.js";
import { TOOL_DEFINITIONS } from "./tool-definitions.js";
import {
  getOrCreateSession,
  loadMessages,
  saveMessages,
  prepareMessages,
  getOrCreateWebSession,
  getSystemPromptForUser,
  updateSessionName,
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

function createToolExecutor(bridgeUrl: string) {
  return async (toolName: string, args: Record<string, unknown>): Promise<string> => {
    const response = await fetch(`${bridgeUrl}/tools/${toolName}`, {
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
    return bridgeResult.result?.content?.[0]?.text
      ?? JSON.stringify(bridgeResult.result);
  };
}

async function processAiMessages(
  sessionId: string,
  userMessage: string,
  systemPrompt: string,
  apiKey: string,
  baseUrl: string,
  bridgeUrl: string,
): Promise<ChatMessage[]> {
  const messages = prepareMessages(sessionId, userMessage, systemPrompt);

  const resultMessages = await executeToolCallLoop(
    messages,
    TOOL_DEFINITIONS,
    apiKey,
    baseUrl,
    createToolExecutor(bridgeUrl),
  );

  saveMessages(sessionId, resultMessages);
  return resultMessages;
}

function getLastAssistantReply(resultMessages: ChatMessage[]): string {
  const lastAssistant = [...resultMessages]
    .reverse()
    .find((m) => m.role === "assistant" && m.content);
  return lastAssistant?.content ?? "回答を生成できませんでした。";
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

  try {
    const resultMessages = await processAiMessages(
      session.sessionId,
      userMessage,
      getSystemPromptForUser("__discord__"),
      ctx.apiKey,
      ctx.baseUrl,
      ctx.bridgeUrl,
    );

    const body = getLastAssistantReply(resultMessages);
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

export interface WebAskContext {
  userId: string;
  sessionId?: string;
  apiKey: string;
  baseUrl: string;
  bridgeUrl: string;
}

export async function runAskForWeb(
  userMessage: string,
  ctx: WebAskContext,
): Promise<{ sessionId: string; reply: string }> {
  const session = getOrCreateWebSession(ctx.userId, ctx.sessionId);

  const systemPrompt = getSystemPromptForUser(ctx.userId);

  const resultMessages = await processAiMessages(
    session.sessionId,
    userMessage,
    systemPrompt,
    ctx.apiKey,
    ctx.baseUrl,
    ctx.bridgeUrl,
  );

  const isNewSession = !ctx.sessionId;
  if (isNewSession && userMessage.trim().length > 0) {
    const now = new Date();
    const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const preview = userMessage.replace(/\n/g, " ").trim().slice(0, 30);
    const name = `${ts} - ${preview}`;
    updateSessionName(session.sessionId, name);
  }

  const reply = getLastAssistantReply(resultMessages);
  console.log(`[ai] Web応答生成完了: userId=${ctx.userId} session=${session.sessionId}`);

  const rawSessionId = session.sessionId.includes(":session:")
    ? session.sessionId.slice(session.sessionId.lastIndexOf(":session:") + 9)
    : session.sessionId;

  return { sessionId: rawSessionId, reply };
}

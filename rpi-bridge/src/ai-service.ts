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
const MAX_TOKENS = 4096;

/** API 1 回あたりの上限。応答が返らないまま処理全体が固まるのを防ぐ */
const API_TIMEOUT_MS = 120_000;
const TOOL_TIMEOUT_MS = 60_000;

/**
 * Discord の interaction token は 15 分で失効し、以降は応答を送れない。
 * 締切のこの手前でツール呼び出しを打ち切り、残り時間で最終回答を生成する。
 */
const DISCORD_INTERACTION_TTL_MS = 15 * 60 * 1000;
const DEADLINE_MARGIN_MS = 3 * 60 * 1000;

const TRUNCATED_NOTICE =
  "\n\n---\n（回答が長くなりすぎたため、ここで途切れています。「続き」と聞くと続きから答えます）";

export async function chatCompletion(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  apiKey: string,
  baseUrl: string,
): Promise<{ content: string | null; toolCalls: ToolCall[]; finishReason: string }> {
  // tools が空のときはフィールドごと省く。空配列を受け付けない API 実装があるため
  const payload = JSON.stringify({
    model: MODEL,
    messages,
    ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
    max_tokens: MAX_TOKENS,
  });
  console.log(`[ai] chatCompletion payloadSize=${payload.length} messages=${messages.length}`);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: payload,
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
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

/**
 * ツールを渡さずに 1 回だけ生成し、そこまでに集めた情報で回答をまとめさせる。
 * ツール呼び出しの上限や締切に達したとき、無言で打ち切らないための最後の一手。
 */
async function finalizeWithoutTools(
  messages: ChatMessage[],
  apiKey: string,
  baseUrl: string,
  reason: string,
  fallbackNotice: string,
): Promise<ChatMessage[]> {
  console.warn(`[ai] ツール呼び出しを打ち切り (${reason}) — 収集済みの情報で回答をまとめます`);

  try {
    const { content, finishReason } = await chatCompletion(messages, [], apiKey, baseUrl);
    if (content) {
      messages.push({
        role: "assistant",
        content: finishReason === "length" ? content + TRUNCATED_NOTICE : content,
      });
      return messages;
    }
  } catch (error) {
    console.error("[ai] 最終回答の生成に失敗:", error);
  }

  messages.push({ role: "assistant", content: fallbackNotice });
  return messages;
}

export async function executeToolCallLoop(
  initialMessages: ChatMessage[],
  tools: ToolDefinition[],
  apiKey: string,
  baseUrl: string,
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>,
  deadlineAt?: number,
): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [...initialMessages];
  let loop = 0;

  while (loop < MAX_TOOL_CALLS) {
    if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
      return finalizeWithoutTools(
        messages,
        apiKey,
        baseUrl,
        `締切超過 loop=${loop}`,
        "調べている途中で時間切れになりました。質問を絞ってもう一度聞いてください。",
      );
    }

    const { content, toolCalls, finishReason } = await chatCompletion(
      messages,
      tools,
      apiKey,
      baseUrl,
    );

    // 出力上限に当たったケース。ツール呼び出しが混ざっていても引数が壊れている
    // 可能性があるため実行せず、途切れたことを明示して打ち切る
    if (finishReason === "length") {
      console.warn(`[ai] 出力が max_tokens=${MAX_TOKENS} に達して途切れました (loop=${loop})`);
      messages.push({ role: "assistant", content: (content ?? "") + TRUNCATED_NOTICE });
      return messages;
    }

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

  return finalizeWithoutTools(
    messages,
    apiKey,
    baseUrl,
    `ツール呼び出し上限 ${MAX_TOOL_CALLS} 回に到達`,
    "調べることが多すぎて、まとめきれませんでした。質問を分けてもう一度聞いてください。",
  );
}

function createToolExecutor(bridgeUrl: string) {
  return async (toolName: string, args: Record<string, unknown>): Promise<string> => {
    let response: Response;
    try {
      response = await fetch(`${bridgeUrl}/tools/${toolName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
      });
    } catch (error) {
      // 例外を投げるとループ全体が落ちるため、失敗も結果として AI に返す
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ai] ツール呼び出し失敗 [${toolName}]: ${message}`);
      return JSON.stringify({ success: false, error: `Tool call failed: ${message}` });
    }
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
  deadlineAt?: number,
): Promise<ChatMessage[]> {
  const messages = prepareMessages(sessionId, userMessage, systemPrompt);

  const resultMessages = await executeToolCallLoop(
    messages,
    TOOL_DEFINITIONS,
    apiKey,
    baseUrl,
    createToolExecutor(bridgeUrl),
    deadlineAt,
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

  // interaction token が失効すると応答手段が完全に失われるため、
  // Worker が受信した時点を起点に締切を引く
  const deadlineAt = Date.now() + DISCORD_INTERACTION_TTL_MS - DEADLINE_MARGIN_MS;

  try {
    const resultMessages = await processAiMessages(
      session.sessionId,
      userMessage,
      getSystemPromptForUser("__discord__"),
      ctx.apiKey,
      ctx.baseUrl,
      ctx.bridgeUrl,
      deadlineAt,
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

  // 新規セッションは最初の発言をそのままセッション名にする。
  // 日時は一覧側で updated_at から相対表示するため、名前には含めない。
  const isNewSession = !ctx.sessionId;
  if (isNewSession && userMessage.trim().length > 0) {
    const name = userMessage.replace(/\s+/g, " ").trim().slice(0, 40);
    updateSessionName(session.sessionId, name);
  }

  const reply = getLastAssistantReply(resultMessages);
  console.log(`[ai] Web応答生成完了: userId=${ctx.userId} session=${session.sessionId}`);

  const rawSessionId = session.sessionId.includes(":session:")
    ? session.sessionId.slice(session.sessionId.lastIndexOf(":session:") + 9)
    : session.sessionId;

  return { sessionId: rawSessionId, reply };
}

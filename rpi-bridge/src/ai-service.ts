import type { ChatMessage, ToolCall, ToolDefinition, ModelDefinition, OpenCodeGoResponse } from "./types.js";
import { TOOL_DEFINITIONS } from "./tool-definitions.js";
import { formatToolResult } from "./tool-result-formatter.js";
import {
  applyPartyNamespace,
  stripPartyNamespace,
  webNamespace,
  DISCORD_NAMESPACE,
} from "./party-namespace.js";
import { describeToolCall, type ToolProgress } from "./tool-progress.js";
import {
  getOrCreateSession,
  loadMessages,
  saveMessages,
  prepareMessages,
  getOrCreateWebSession,
  getSystemPromptForUser,
  getDefaultModelId,
  getUserModelId,
  updateSessionName,
} from "./conversation-manager.js";
import { editOriginalResponse } from "./discord-webhook.js";
import { resolveModelDefinition, DEFAULT_MODEL_ID } from "./model-registry.js";
import {
  isReviewTurn,
  extractMatchId,
  inspectReview,
  buildEvaluatorMessages,
  parseVerdict,
  buildRevisionMessages,
} from "./review-harness.js";
import { saveMatchReview, buildMatchReview } from "./match-reviews.js";

// モデル・reasoning_effort・max_tokens は model-registry.ts のモデル定義に移した
// （ADR-0015）。理由: モデル名だけ差し替えると unknown の reasoning_effort が
// 黙って既定へフォールバックするため、モデルと推論設定を一体管理する。
const MAX_TOOL_CALLS = 30;

/**
 * API 1 回あたりの上限。応答が返らないまま処理全体が固まるのを防ぐ。
 * モデルのホスト先が変わってレイテンシが伸び、120 秒では足りなくなった。
 */
const API_TIMEOUT_MS = 240_000;
const TOOL_TIMEOUT_MS = 60_000;

/**
 * Discord の interaction token は 15 分で失効し、以降は応答を送れない。
 * 締切のこの手前でツール呼び出しを打ち切り、残り時間で最終回答を生成する。
 */
const DISCORD_INTERACTION_TTL_MS = 15 * 60 * 1000;
const DEADLINE_MARGIN_MS = 3 * 60 * 1000;

/**
 * 評価役 LLM を起動してよい残り時間の目安（ADR-0017）。
 * 評価役 + 書き直しで最大 2 回の LLM 呼び出しが入るため、締切の直近では
 * 検品を飛ばして、集めた情報で回答を届けることを優先する。
 */
const EVALUATOR_MARGIN_MS = 3 * 60 * 1000;
const REVISION_MARGIN_MS = 60 * 1000;

const TRUNCATED_NOTICE =
  "\n\n---\n（回答が長くなりすぎたため、ここで途切れています。「続き」と聞くと続きから答えます）";

/**
 * 途中で切れた回答の続きを求められたとき、最初から書き直させないための補足。
 *
 * system の末尾に足すのは、prepareMessages が次回のリクエストで systemPrompt と
 * 突き合わせて先頭を差し替えるため、この補足が履歴に焼き付かずに消えるからである。
 * user 発言に足すと DB に残り、以降ずっとノイズになる。
 */
const CONTINUATION_HINT = `

## 直前の回答について
直前の回答は出力上限に達して途中で終わっています。
利用者が続きを求めている場合は、すでに書いた内容を繰り返さず、途切れた箇所の直後から書き始めてください。`;

/** 直前が途切れた回答なら、system に継続指示を足した配列を返す */
function applyContinuationHint(messages: ChatMessage[]): ChatMessage[] {
  // 末尾は今回の user 発言。その 1 つ手前が途切れた回答かどうかを見る
  const previous = messages[messages.length - 2];
  const isTruncated =
    previous?.role === "assistant" && (previous.content?.endsWith(TRUNCATED_NOTICE) ?? false);
  if (!isTruncated) return messages;

  const [system, ...rest] = messages;
  if (system?.role !== "system") return messages;

  console.log("[ai] 直前の回答が途中終了しているため継続指示を付与");
  return [{ ...system, content: (system.content ?? "") + CONTINUATION_HINT }, ...rest];
}

export interface ChatCompletionResult {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string;
  /** 実際に使われたモデル（応答の data.model を正とする。ADR-0016） */
  model: string;
}

export async function chatCompletion(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  model: ModelDefinition,
  apiKey: string,
  baseUrl: string,
): Promise<ChatCompletionResult> {
  // tools が空のときはフィールドごと省く。空配列を受け付けない API 実装があるため
  // reasoning_effort も null のモデルではキー自体を省く（推論非対応モデル用）
  const payload = JSON.stringify({
    model: model.id,
    messages,
    ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
    max_tokens: model.max_tokens,
    ...(model.reasoning_effort != null ? { reasoning_effort: model.reasoning_effort } : {}),
  });
  // ツール定義は毎ターン再送されるため、payloadSize のうち何が固定費で
  // 何が会話の伸びなのかを分けて記録する
  const toolsSize = tools.length > 0 ? JSON.stringify(tools).length : 0;
  console.log(
    `[ai] chatCompletion model=${model.id} payloadSize=${payload.length} toolsSize=${toolsSize} messagesSize=${payload.length - toolsSize} messages=${messages.length}`,
  );

  // タイムアウトの調整には「何秒で返ってきているか」が要る。
  // 失敗時も測っておかないと、上限に達したのか即座に弾かれたのか区別できない
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: payload,
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ai] chatCompletion 失敗 elapsed=${Date.now() - startedAt}ms: ${message}`);
    throw error;
  }
  console.log(`[ai] chatCompletion 応答 elapsed=${Date.now() - startedAt}ms status=${response.status}`);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenCode Go API error (${response.status}): ${text}`);
  }

  const data = (await response.json()) as OpenCodeGoResponse;

  // reasoning_effort の効き具合と、固定 prefix であるツール定義がキャッシュに
  // 乗っているかを追う。どちらもこの内訳がないと判断できない
  const usage = data.usage;
  if (usage) {
    console.log(
      `[ai] usage prompt=${usage.prompt_tokens} cacheHit=${usage.prompt_cache_hit_tokens ?? "-"}` +
        ` completion=${usage.completion_tokens} reasoning=${usage.completion_tokens_details?.reasoning_tokens ?? 0}`,
    );
  }

  const choice = data.choices[0];
  const message = choice.message;

  return {
    content: message.content,
    toolCalls: message.tool_calls ?? [],
    finishReason: choice.finish_reason,
    // ゲートウェイが黙って既定へ落とした場合も、ここで実モデルが分かる（ADR-0016）
    model: data.model || model.id,
  };
}

/**
 * ツールを渡さずに 1 回だけ生成し、そこまでに集めた情報で回答をまとめさせる。
 * ツール呼び出しの上限や締切に達したとき、無言で打ち切らないための最後の一手。
 */
async function finalizeWithoutTools(
  messages: ChatMessage[],
  model: ModelDefinition,
  apiKey: string,
  baseUrl: string,
  reason: string,
  fallbackNotice: string,
): Promise<ChatMessage[]> {
  console.warn(`[ai] ツール呼び出しを打ち切り (${reason}) — 収集済みの情報で回答をまとめます (model=${model.id})`);

  try {
    const { content, finishReason, model: actualModel } =
      await chatCompletion(messages, [], model, apiKey, baseUrl);
    if (content) {
      messages.push({
        role: "assistant",
        content: finishReason === "length" ? content + TRUNCATED_NOTICE : content,
        model: actualModel,
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
  model: ModelDefinition,
  apiKey: string,
  baseUrl: string,
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>,
  deadlineAt?: number,
  onProgress?: (progress: ToolProgress) => void,
): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [...initialMessages];
  let loop = 0;

  while (loop < MAX_TOOL_CALLS) {
    if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
      return finalizeWithoutTools(
        messages,
        model,
        apiKey,
        baseUrl,
        `締切超過 loop=${loop}`,
        "調べている途中で時間切れになりました。質問を絞ってもう一度聞いてください。",
      );
    }

    let completion: ChatCompletionResult;
    try {
      completion = await chatCompletion(messages, tools, model, apiKey, baseUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const hasToolResults = messages.some((m) => m.role === "tool");

      // 選択モデルが既定でなく失敗した場合は、既定モデルで最終回答を試みる
      // （ADR-0015）。既定モデル自体が最初の呼び出しで失敗した場合は、API 全体が
      // 落ちている可能性が高いため例外のまま上へ投げる（従来どおり）。
      if (model.id !== DEFAULT_MODEL_ID) {
        const fallback = resolveModelDefinition(DEFAULT_MODEL_ID);
        console.warn(
          `[ai] モデル ${model.id} の呼び出しに失敗したため既定モデル ${fallback.id} へフォールバック (loop=${loop}): ${message}`,
        );
        return finalizeWithoutTools(
          messages,
          fallback,
          apiKey,
          baseUrl,
          `API 呼び出し失敗 loop=${loop}: ${message}`,
          "調べている途中で応答が返らなくなりました。もう一度聞いてください。",
        );
      }

      // API 側の失敗でループごと落とすと、ここまでのツール往復が丸ごと消える。
      // 集めた結果があるなら、それでまとめさせる方に倒す。
      // この経路はツール定義を送らないため入力も軽く、通りやすい。
      if (!hasToolResults) throw error;

      return finalizeWithoutTools(
        messages,
        model,
        apiKey,
        baseUrl,
        `API 呼び出し失敗 loop=${loop}: ${message}`,
        "調べている途中で応答が返らなくなりました。もう一度聞いてください。",
      );
    }
    const { content, toolCalls, finishReason } = completion;

    // 出力上限に当たったケース。ツール呼び出しが混ざっていても引数が壊れている
    // 可能性があるため実行せず、途切れたことを明示して打ち切る
    if (finishReason === "length") {
      console.warn(`[ai] 出力が max_tokens=${model.max_tokens} に達して途切れました (loop=${loop})`);
      messages.push({
        role: "assistant",
        content: (content ?? "") + TRUNCATED_NOTICE,
        model: completion.model,
      });
      return messages;
    }

    if (finishReason === "stop") {
      if (content) {
        messages.push({ role: "assistant", content, model: completion.model });
      }
      return messages;
    }

    if (toolCalls.length === 0) {
      if (content) {
        messages.push({ role: "assistant", content, model: completion.model });
      }
      return messages;
    }

    messages.push({
      role: "assistant",
      content: content,
      tool_calls: toolCalls,
      model: completion.model,
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
      // 進捗通知の失敗で本処理を落とさない
      try {
        onProgress?.(describeToolCall(functionName, functionArgs));
      } catch (error) {
        console.error("[ai] 進捗通知に失敗:", error);
      }

      const result = await executeTool(functionName, functionArgs);
      // 整形後の実サイズ。ツールごとの寄与を後から集計するために残す
      console.log(`[ai] ツール結果: ${functionName} chars=${result.length}`);

      // 結果は executeTool 側（整形層）で LLM に渡せる大きさに整えられている
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }

    loop++;
  }

  return finalizeWithoutTools(
    messages,
    model,
    apiKey,
    baseUrl,
    `ツール呼び出し上限 ${MAX_TOOL_CALLS} 回に到達`,
    "調べることが多すぎて、まとめきれませんでした。質問を分けてもう一度聞いてください。",
  );
}

function createToolExecutor(bridgeUrl: string, namespace: string) {
  return async (toolName: string, args: Record<string, unknown>): Promise<string> => {
    // パーティ系ツールは利用者ごとの名前空間を付けてから呼ぶ
    const scopedArgs = applyPartyNamespace(toolName, args, namespace);

    let response: Response;
    try {
      response = await fetch(`${bridgeUrl}/tools/${toolName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scopedArgs),
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
    const raw = bridgeResult.result?.content?.[0]?.text
      ?? JSON.stringify(bridgeResult.result);
    // 名前空間を外してから整形する（AI と利用者には元の名前だけを見せる）
    return formatToolResult(toolName, stripPartyNamespace(toolName, raw, namespace));
  };
}

/** 最後の assistant 本文（最終回答）の位置。無ければ -1 */
function findLastAssistantReplyIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant" && messages[i].content) return i;
  }
  return -1;
}

/**
 * 対戦振り返りの検品と記録（ADR-0017）。
 *
 * 振り返りターン（list_matches / get_match を呼んだターン）に限って、
 * 機械的検品 → 評価役 LLM（必要なら 1 回だけ書き直し）→ match_reviews へ保存
 * の順で処理する。検品で会話を止めない（ADR-0011 と同じ方針）。
 */
async function applyReviewHarness(
  messages: ChatMessage[],
  model: ModelDefinition,
  apiKey: string,
  baseUrl: string,
  deadlineAt?: number,
): Promise<ChatMessage[]> {
  if (!isReviewTurn(messages)) return messages;

  const replyIndex = findLastAssistantReplyIndex(messages);
  if (replyIndex < 0) return messages;

  const draft = messages[replyIndex].content ?? "";
  const mechanicalIssues = inspectReview(draft, messages);
  if (mechanicalIssues.length > 0) {
    console.warn(`[review] 機械的検品で ${mechanicalIssues.length} 件の指摘:`, mechanicalIssues);
  }

  // 評価役 LLM。締切の直近では飛ばして、回答を届けることを優先する
  let revised = draft;
  const canEvaluate = deadlineAt === undefined || Date.now() < deadlineAt - EVALUATOR_MARGIN_MS;
  if (canEvaluate) {
    try {
      const verdictResult = await chatCompletion(
        buildEvaluatorMessages(draft, messages, mechanicalIssues),
        [],
        model,
        apiKey,
        baseUrl,
      );
      const verdict = verdictResult.content ? parseVerdict(verdictResult.content) : null;
      if (verdict && !verdict.pass) {
        console.warn(`[review] 評価役が不合格と判定。1 回だけ書き直します:`, verdict.issues);
        const canRevise = deadlineAt === undefined || Date.now() < deadlineAt - REVISION_MARGIN_MS;
        if (canRevise) {
          const revisionResult = await chatCompletion(
            buildRevisionMessages(draft, verdict.issues),
            [],
            model,
            apiKey,
            baseUrl,
          );
          if (revisionResult.content) revised = revisionResult.content;
        } else {
          console.warn("[review] 締切が近いため書き直しを省略します");
        }
      } else if (verdict) {
        console.log("[review] 評価役の検品に合格");
      } else {
        console.warn("[review] 評価役の返答を解釈できませんでした。元の回答で続行します");
      }
    } catch (error) {
      console.error("[review] 評価役の呼び出しに失敗しました。元の回答で続行します:", error);
    }
  }

  // 機械的検品の指摘は「削る」より「注記」で伝える（ADR-0017）
  let finalReply = revised;
  if (mechanicalIssues.length > 0) {
    finalReply =
      revised +
      "\n\n---\n（振り返りの確認メモ）\n" +
      mechanicalIssues.map((x) => `- ${x}`).join("\n");
  }
  messages[replyIndex] = { ...messages[replyIndex], content: finalReply };

  // 記録: get_match で特定できた対戦を保存（注記を除いた本文を残す）
  const matchId = extractMatchId(messages);
  if (matchId !== undefined) {
    try {
      saveMatchReview(buildMatchReview(matchId, revised));
      console.log(`[review] 振り返りを保存: ${matchId}`);
    } catch (error) {
      console.error("[review] 振り返りの保存に失敗しました:", error);
    }
  }

  return messages;
}

async function processAiMessages(
  sessionId: string,
  userMessage: string,
  systemPrompt: string,
  model: ModelDefinition,
  apiKey: string,
  baseUrl: string,
  bridgeUrl: string,
  namespace: string,
  deadlineAt?: number,
  onProgress?: (progress: ToolProgress) => void,
): Promise<ChatMessage[]> {
  const messages = applyContinuationHint(
    prepareMessages(sessionId, userMessage, systemPrompt),
  );

  const resultMessages = await executeToolCallLoop(
    messages,
    TOOL_DEFINITIONS,
    model,
    apiKey,
    baseUrl,
    createToolExecutor(bridgeUrl, namespace),
    deadlineAt,
    onProgress,
  );

  // 対戦振り返りターンは検品と記録を挟む（ADR-0017）
  const reviewedMessages = await applyReviewHarness(
    resultMessages,
    model,
    apiKey,
    baseUrl,
    deadlineAt,
  );

  saveMessages(sessionId, reviewedMessages);
  return reviewedMessages;
}

function getLastAssistantReply(resultMessages: ChatMessage[]): string {
  const lastAssistant = [...resultMessages]
    .reverse()
    .find((m) => m.role === "assistant" && m.content);
  return lastAssistant?.content ?? "回答を生成できませんでした。";
}

/** 最後の回答を実際に生成したモデル ID（ADR-0016）。フォールバックを反映する */
function getLastAssistantModel(resultMessages: ChatMessage[]): string | undefined {
  const lastAssistant = [...resultMessages]
    .reverse()
    .find((m) => m.role === "assistant" && m.content);
  return lastAssistant?.model;
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
    const model = resolveModelDefinition(getDefaultModelId());

    const resultMessages = await processAiMessages(
      session.sessionId,
      userMessage,
      getSystemPromptForUser("__discord__"),
      model,
      ctx.apiKey,
      ctx.baseUrl,
      ctx.bridgeUrl,
      DISCORD_NAMESPACE,
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
  /** SSE で進捗を配信する場合に渡す。省略時は通知しない */
  onProgress?: (progress: ToolProgress) => void;
}

export async function runAskForWeb(
  userMessage: string,
  ctx: WebAskContext,
): Promise<{ sessionId: string; reply: string; model?: string }> {
  const session = getOrCreateWebSession(ctx.userId, ctx.sessionId);

  const systemPrompt = getSystemPromptForUser(ctx.userId);

  // Web は利用者別モデル、未設定は既定に従う（ADR-0015）
  const model = resolveModelDefinition(getUserModelId(ctx.userId));

  const resultMessages = await processAiMessages(
    session.sessionId,
    userMessage,
    systemPrompt,
    model,
    ctx.apiKey,
    ctx.baseUrl,
    ctx.bridgeUrl,
    webNamespace(ctx.userId),
    undefined,
    ctx.onProgress,
  );

  // 新規セッションは最初の発言をそのままセッション名にする。
  // 日時は一覧側で updated_at から相対表示するため、名前には含めない。
  const isNewSession = !ctx.sessionId;
  if (isNewSession && userMessage.trim().length > 0) {
    const name = userMessage.replace(/\s+/g, " ").trim().slice(0, 40);
    updateSessionName(session.sessionId, name);
  }

  const reply = getLastAssistantReply(resultMessages);
  const modelUsed = getLastAssistantModel(resultMessages);
  console.log(`[ai] Web応答生成完了: userId=${ctx.userId} session=${session.sessionId} model=${modelUsed ?? "-"}`);

  const rawSessionId = session.sessionId.includes(":session:")
    ? session.sessionId.slice(session.sessionId.lastIndexOf(":session:") + 9)
    : session.sessionId;

  return { sessionId: rawSessionId, reply, model: modelUsed };
}

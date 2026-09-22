/**
 * 共有実行層（ADR-0020）。
 *
 * ツール結果の「整形＋パーティ名前空間」の適用を ask ループ（ai-service.ts）から
 * 切り離し、ブリッジの 1 箇所に一本化する。ai-service はプロセス内でこれを直接呼び、
 * 外部利用者（pi 連携）は HTTP エンドポイント POST /api/tools/:name/run 経由で同じ
 * 実行層へ到達する。
 *
 * 適用順は従来の createToolExecutor と同一:
 *   applyPartyNamespace（実行前）→ 実行 → stripPartyNamespace（実行後）→
 *   formatToolResult（実行後）
 *
 * 詳しい経緯は docs/adr/ADR-0020.md を参照。
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { formatToolResult } from "./tool-result-formatter.js";
import { applyPartyNamespace, stripPartyNamespace } from "./party-namespace.js";
import { isMatchTool, executeMatchTool } from "./match-repository.js";
import { isTheoryTool, executeTheoryTool } from "./theory-import.js";
import { isRankingTool, executeRankingTool } from "./ranking.js";
import { isReviewTool, executeReviewTool } from "./match-reviews.js";

/** ツール実行の打ち切り上限（ADR-0020 DP3）。従来の loopback fetch が担っていた */
const TOOL_TIMEOUT_MS = 60_000;

/** 生のツール実行（整形・名前空間の適用前）。MCP とブリッジ側ツールの分岐を持つ */
export type ExecuteRaw = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<string>;

/** 整形・名前空間込みの実行結果 */
export type ToolRunResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export type RunTool = (
  namespace: string,
  toolName: string,
  args: Record<string, unknown>,
) => Promise<ToolRunResult>;

/**
 * 生のツール実行バックエンドを作る。
 *
 * - 対戦記録（ADR-0010）・育成論（ADR-0013）・ランキング（ADR-0014）・振り返り
 *   （ADR-0017）は MCP を経由せずブリッジ側で処理する
 * - それ以外は MCP `client.callTool`。`timeout` を渡して実キャンセルする
 *   （ADR-0020 DP3。SDK の RequestOptions.timeout。既定も 60 秒だが明示する）
 */
export function createExecuteRaw(client: Client): ExecuteRaw {
  return async (toolName, args) => {
    if (isMatchTool(toolName)) return executeMatchTool(toolName, args);
    if (isTheoryTool(toolName)) return executeTheoryTool(toolName, args);
    if (isRankingTool(toolName)) return executeRankingTool(toolName, args);
    if (isReviewTool(toolName)) return executeReviewTool(toolName, args);

    // callTool の戻り型はタスク実行を含む union のため、content の取り出しだけを
    // 自前の型に写して扱う（実際に使うのは text 内容のみ）
    const result = (await client.callTool(
      { name: toolName, arguments: args },
      undefined,
      { timeout: TOOL_TIMEOUT_MS },
    )) as { content?: Array<{ type: string; text: string }> };
    const first = result.content?.[0];
    return first && first.type === "text" ? first.text : JSON.stringify(result);
  };
}

/**
 * 60 秒で打ち切る Promise。abort ではなく「待つのを諦める」挙動
 * （give-up-waiting）を保つ。背後の実行は止まらない（従来の loopback fetch の
 * abort と同じ）。
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Tool execution timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * 整形・名前空間込みの実行層を作る。
 *
 * `applyPartyNamespace`（実行前）→ 実行 → `stripPartyNamespace`（実行後）→
 * `formatToolResult`（実行後）の順で適用し、LLM に渡せる形にして返す。
 * 実行の失敗は例外にせず `{ ok: false, error }` で返す（会話を止めない方針）。
 */
export function createRunTool(executeRaw: ExecuteRaw): RunTool {
  return async (namespace, toolName, args) => {
    const scopedArgs = applyPartyNamespace(toolName, args, namespace);
    try {
      const raw = await withTimeout(executeRaw(toolName, scopedArgs), TOOL_TIMEOUT_MS);
      const text = formatToolResult(
        toolName,
        stripPartyNamespace(toolName, raw, namespace),
      );
      return { ok: true, text };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[tool-runner] ツール実行失敗 [${toolName}]: ${message}`);
      return { ok: false, error: message };
    }
  };
}

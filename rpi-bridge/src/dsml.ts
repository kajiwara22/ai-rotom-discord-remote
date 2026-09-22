import type { ToolCall } from "./types.js";
import crypto from "node:crypto";

/**
 * DeepSeek 系モデルが推論中にツール呼び出しを書く DSML（DeepSeek Markup
 * Language）の解釈。
 *
 * reasoning_effort 付きの推論モデルは、ツールを呼びたいとき推論テキストに
 * 次のようなマークアップを書く。本来はゲートウェイがこれを構造化された
 * `tool_calls` 配列へ変換して返すが、変換されず `content`（本文）に残ったまま
 * `finish_reason: "stop"` で返ってくる応答がある。放置すると生のマークアップが
 * チャットに漏れるうえ、ツールも実行されないため、ここで自前解釈する。
 *
 *   <｜DSML｜tool_calls>
 *   <｜DSML｜invoke name="get_pokemon_summary">
 *   <｜DSML｜parameter name="name" string="true">メガルカリオZ</｜DSML｜parameter>
 *   </｜DSML｜invoke>
 *   </｜DSML｜tool_calls>
 *
 * 区切り文字は全角縦棒（U+FF5C）だが、経路によって半角（U+007C）へ化ける実装も
 * あるため両方を受け付ける。閉じタグは `</…>` のほか `<` や `/` が欠けた形
 * （`｜DSML｜parameter>`）で来ることもあるため、緩く受ける。
 */

const BAR = "[｜|]";

// <｜DSML｜tool_calls> ... </｜DSML｜tool_calls>（または function_calls）
const WRAPPER_RE = new RegExp(
  `<${BAR}DSML${BAR}(tool_calls|function_calls)>[\\s\\S]*?(?:</?)?${BAR}DSML${BAR}\\1>`,
  "g",
);

// <｜DSML｜invoke name="..."> ... </｜DSML｜invoke>
const INVOKE_RE = new RegExp(
  `<${BAR}DSML${BAR}invoke\\s+name="([^"]+)"[^>]*>([\\s\\S]*?)(?:</?)?${BAR}DSML${BAR}invoke>`,
  "g",
);

// <｜DSML｜parameter name="..." string="true"> ... </｜DSML｜parameter>
const PARAM_RE = new RegExp(
  `<${BAR}DSML${BAR}parameter\\s+name="([^"]+)"([^>]*)>([\\s\\S]*?)(?:</?)?${BAR}DSML${BAR}parameter>`,
  "g",
);

// 閉じられなかった DSML の断片（出力が途中で切れた場合）を末尾まで除去する
const DANGLING_RE = new RegExp(`<${BAR}DSML${BAR}.*$`, "s");

export interface DsmlParseResult {
  /** DSML を取り除いた本文（DSML だけだった場合は空文字） */
  content: string;
  toolCalls: ToolCall[];
}

/**
 * パラメータ値を型へ変換する。
 * `string="true"` は文字列リテラル。それ以外は JSON（数値・真偽値・object・
 * array）として解釈し、解釈できなければ文字列へ落とす。
 */
function coerceParameter(attrs: string, rawValue: string): unknown {
  const value = rawValue.trim();
  if (/string="true"/.test(attrs)) return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * content 内の DSML ツール呼び出しを `ToolCall[]` へ変換し、本文からは除去する。
 * DSML が無ければ本文をそのまま返す（通常応答へのオーバーヘッドを避ける）。
 */
export function parseDsml(content: string | null): DsmlParseResult {
  if (!content) return { content: "", toolCalls: [] };
  if (!content.includes("DSML")) return { content, toolCalls: [] };

  const toolCalls: ToolCall[] = [];

  INVOKE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INVOKE_RE.exec(content)) !== null) {
    const name = m[1];
    const body = m[2];
    const args: Record<string, unknown> = {};

    PARAM_RE.lastIndex = 0;
    let pm: RegExpExecArray | null;
    while ((pm = PARAM_RE.exec(body)) !== null) {
      args[pm[1]] = coerceParameter(pm[2] ?? "", pm[3] ?? "");
    }

    toolCalls.push({
      id: crypto.randomUUID(),
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
    });
  }

  return { content: stripDsml(content), toolCalls };
}

/** 本文から DSML を除去する。表示専用の経路（履歴 API など）でも使う */
export function stripDsml(content: string): string {
  let out = content.replace(WRAPPER_RE, "");
  out = out.replace(DANGLING_RE, "");
  return out.trim();
}

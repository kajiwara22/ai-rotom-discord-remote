/**
 * 対戦振り返りハーネス（ADR-0017）。
 *
 * 「できました」を信用せず、振り返り回答の品質を検品する層。
 * 機械的検品（決定的な違反をツール呼び出し履歴から検知）と評価役 LLM
 * （完成条件に照らした採点）の 2 段で構成する。
 *
 * このモジュールは判定・プロンプト構築だけを持ち、LLM 呼び出しは
 * ai-service.ts 側が行う（循環 import を避けるため）。
 */
import type { ChatMessage } from "./types.js";

/** 対戦振り返りの入口となるツール。これらを呼んだターンを振り返りとみなす */
const REVIEW_TOOLS = ["list_matches", "get_match"];

/** このターンが対戦振り返りかどうか（list_matches / get_match を呼んだか） */
export function isReviewTurn(messages: ChatMessage[]): boolean {
  return messages.some(
    (m) =>
      m.role === "assistant" &&
      m.tool_calls?.some((tc) => REVIEW_TOOLS.includes(tc.function.name)),
  );
}

/** このターンに呼ばれたツール名（順序込み） */
function calledToolNames(messages: ChatMessage[]): string[] {
  const names: string[] = [];
  for (const m of messages) {
    if (m.role === "assistant" && m.tool_calls) {
      for (const tc of m.tool_calls) names.push(tc.function.name);
    }
  }
  return names;
}

/** get_match に渡された matchId を取り出す（複数回呼ばれた場合は最後） */
export function extractMatchId(messages: ChatMessage[]): string | undefined {
  let matchId: string | undefined;
  for (const m of messages) {
    if (m.role !== "assistant" || !m.tool_calls) continue;
    for (const tc of m.tool_calls) {
      if (tc.function.name !== "get_match") continue;
      try {
        const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        if (typeof args.matchId === "string" && args.matchId.trim() !== "") {
          matchId = args.matchId.trim();
        }
      } catch {
        // 引数が壊れている場合は無視（finish_reason:length で弾かれるのが本来）
      }
    }
  }
  return matchId;
}

/** list_matches の結果（素通し JSON）から matchAtTimestamp を取り出す */
function extractMatchAtTimestamp(messages: ChatMessage[]): string | undefined {
  for (const m of messages) {
    if (m.role !== "tool" || !m.content) continue;
    let data: unknown;
    try {
      data = JSON.parse(m.content);
    } catch {
      continue;
    }
    if (data !== null && typeof data === "object" && "matchAtTimestamp" in data) {
      const value = (data as Record<string, unknown>).matchAtTimestamp;
      if (typeof value === "string" && value !== "") return value;
    }
  }
  return undefined;
}

/** 分析系ツール（SP・持ち物・技を正しく渡す必要があるもの）か */
function isAnalysisTool(name: string): boolean {
  return (
    name.startsWith("analyze_") ||
    name.startsWith("calculate_damage_") ||
    name === "find_counters" ||
    name === "compare_parties"
  );
}

/**
 * 機械的検品。決定的に検知できる違反を注記として返す（空配列 = 違反なし）。
 *
 * 検知できるのはツール呼び出しの並びと本文の表層で分かるものに限る。
 * 「ポケモン名のハルシネーション」は固有名詞辞書が要るため TBD として
 * 未実装（ADR-0017）。文脈に依存する違反（従来作の仕様で語る等）は評価役 LLM が担う。
 */
export function inspectReview(reply: string, messages: ChatMessage[]): string[] {
  const issues: string[] = [];
  const names = calledToolNames(messages);

  // 1. load_party を経由せず分析ツールを呼んでいる（SP=0 混入の疑い）
  const usedAnalysis = names.some(isAnalysisTool);
  const usedLoadParty = names.includes("load_party");
  if (usedAnalysis && !usedLoadParty) {
    issues.push(
      "分析ツールが load_party を経由せずに呼ばれています。数値は SP=0・持ち物なしで計算された参考値の可能性があります",
    );
  }

  // 2. 行動ログがないのにターン単位の推移を語る表現（明確なパターンのみ）
  if (/ターン目|ターン推移/.test(reply)) {
    issues.push(
      "対戦記録には行動ログ（技・ダメージ・ターン推移）が含まれていません。ターン単位の断定は記録にない情報です",
    );
  }

  // 3. 再生位置（t=）が指す対戦と、振り返った対戦の食い違い
  const matchAtTimestamp = extractMatchAtTimestamp(messages);
  const matchId = extractMatchId(messages);
  if (
    matchAtTimestamp !== undefined &&
    matchId !== undefined &&
    matchAtTimestamp !== matchId
  ) {
    issues.push(
      `URL の再生位置が指す対戦（${matchAtTimestamp}）と、振り返った対戦（${matchId}）が異なります`,
    );
  }

  return issues;
}

/** 評価役が照合する完成条件（ADR-0017）。採点の正本 */
const ACCEPTANCE_CRITERIA = [
  "対戦を特定している（動画・対戦・勝敗・再生位置 t= が一致）",
  "事実（記録に基づく）と解釈（分析）が分かれている",
  "数値の根拠がツール結果に基づく（記憶や推測の数値を断定していない）",
  "load_party で取得した持ち物・技・性格・SP で分析している（SP=0 混入なし）",
  "行動ログがないのにターン・ダメージ推移を断定していない",
  "従来作（SV 等）の仕様で語っていない",
  "選出（シングル 3 体／ダブル 4 体）とチーム（6 体）を混同していない",
  "「次の一手」など、次に実践できる具体的な結論で締めている",
];

/** 評価役 LLM への入力メッセージを組み立てる */
export function buildEvaluatorMessages(
  reply: string,
  messages: ChatMessage[],
  mechanicalIssues: string[],
): ChatMessage[] {
  const system = `あなたはポケモンチャンピオンズ対戦振り返りの評価役です。
実行役が書いた振り返りを、以下の完成条件に照らして検品してください。

## 完成条件
${ACCEPTANCE_CRITERIA.map((c, i) => `${i + 1}. ${c}`).join("\n")}

## 返答形式
以下の JSON だけを返してください（JSON 以外の文字は書かない）:
{"pass": true/false, "issues": ["指摘1", "指摘2"]}

pass=false にするのは、完成条件への明確な違反がある場合だけです。
軽微な表現の好みや「もっと詳しく書ける」程度のものは指摘しないでください。`;

  const user = [
    "【振り返り回答】",
    reply,
    "",
    "【このターンに呼ばれたツール】",
    calledToolNames(messages).join(", ") || "なし",
    "",
    "【機械的検品の指摘】",
    mechanicalIssues.length > 0 ? mechanicalIssues.join(" / ") : "なし",
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export interface ReviewVerdict {
  pass: boolean;
  issues: string[];
}

/**
 * 評価役の返答を解釈する。
 *
 * 解釈できなかった場合は null を返す（会話を止めない。ADR-0011 と同じ方針）。
 * pass=false なのに issues が空の場合は形式が怪しいため null 扱いにする。
 */
export function parseVerdict(text: string): ReviewVerdict | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;

  const obj = parsed as Record<string, unknown>;
  const pass = obj.pass === true;
  const issues = Array.isArray(obj.issues)
    ? obj.issues
        .filter((x): x is string => typeof x === "string" && x.trim() !== "")
        .map((x) => x.trim())
    : [];

  if (!pass && issues.length === 0) return null;
  return { pass, issues };
}

/** 書き直し（実行役 2 巡目）への入力メッセージを組み立てる */
export function buildRevisionMessages(reply: string, issues: string[]): ChatMessage[] {
  const system = `あなたはポケモンチャンピオンズの対戦アドバイザーです。
先ほど書いた対戦の振り返りに、評価役から以下の指摘が入りました。
指摘をすべて反映して、振り返りをもう一度書き直してください。
ツールは呼ばず、本文だけを書いてください。事実と解釈を分け、数値の根拠を明示してください。`;

  const user = [
    "【元の回答】",
    reply,
    "",
    "【評価役の指摘】",
    issues.map((x, i) => `${i + 1}. ${x}`).join("\n"),
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

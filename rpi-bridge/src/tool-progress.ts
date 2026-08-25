/**
 * ツール実行の進捗を UI へ伝えるための記述子。
 *
 * ツール名をそのまま画面に出すと `get_pokemon_info` のような文字列が子どもの
 * 画面に並ぶ。ここでは種別と対象名だけを返し、実際の文言はクライアントの
 * 語彙テーブル（ADR-0003 の L.kids / L.junior）が組み立てる。
 * 詳しい経緯は docs/adr/ADR-0008.md を参照。
 */

/** 進捗の種別。クライアントはこれをキーに文言を引く */
export type ToolProgressKind =
  | "lookup"
  | "search"
  | "calculate"
  | "analyze"
  | "party"
  | "match"
  | "theory";

export interface ToolProgress {
  kind: ToolProgressKind;
  /** 元のツール名。ログや将来の細分化のために残す */
  tool: string;
  /** 調べている対象（ポケモン名・技名など）。取れなければ省略 */
  target?: string;
}

const PARTY_TOOLS = new Set([
  "save_party",
  "load_party",
  "list_parties",
  "delete_party",
  "import_party_from_text",
]);

/** 対戦記録ツール。`list_` / `get_` の接頭辞で分類すると別の種別に落ちるため先に見る */
const MATCH_TOOLS = new Set(["list_matches", "get_match", "get_party_from_matches"]);

/** 育成論の取り込み（ADR-0013） */
const THEORY_TOOLS = new Set(["import_theory_from_url", "get_theory"]);

function kindOf(toolName: string): ToolProgressKind {
  if (PARTY_TOOLS.has(toolName)) return "party";
  if (MATCH_TOOLS.has(toolName)) return "match";
  if (THEORY_TOOLS.has(toolName)) return "theory";
  if (toolName.startsWith("calculate_")) return "calculate";
  if (toolName.startsWith("search_")) return "search";
  if (toolName.startsWith("get_")) return "lookup";
  // analyze_* / find_counters / compare_parties / list_speed_tiers
  return "analyze";
}

/** ネストしたオブジェクトの name を 1 段だけ拾う */
function nestedName(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const name = (value as Record<string, unknown>).name;
  return typeof name === "string" ? name : undefined;
}

/**
 * 引数から「今なにを調べているか」を 1 つ取り出す。
 * ツールごとに引数名が違うため、よくある位置を順に見る。
 */
function targetOf(args: Record<string, unknown>): string | undefined {
  for (const key of ["name", "moveName", "abilityName", "type", "around"]) {
    const value = args[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  for (const key of ["attacker", "pokemon1", "target", "defender"]) {
    const name = nestedName(args[key]);
    if (name) return name;
  }
  // パーティ系は先頭メンバーを代表にする
  for (const key of ["party", "myParty", "partyA"]) {
    const list = args[key];
    if (Array.isArray(list) && list.length > 0) {
      const name = nestedName(list[0]);
      if (name) return name;
    }
  }
  return undefined;
}

export function describeToolCall(
  toolName: string,
  args: Record<string, unknown>,
): ToolProgress {
  const target = targetOf(args);
  return target === undefined
    ? { kind: kindOf(toolName), tool: toolName }
    : { kind: kindOf(toolName), tool: toolName, target };
}

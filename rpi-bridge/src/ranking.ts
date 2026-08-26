/**
 * ポケモン徹底攻略 (yakkun.com) の「使用率ランキング」の取得。
 *
 * ページ名は「使用率ランキング」だが、実際に公開されているのは順位（1〜100 位）
 * のみで、数値の使用率（%）は存在しない。本モジュールは「順位＋ポケモン名」の
 * 一覧を返し、解説文・種族値・特性・タイプは取り込まない（詳細は既存の
 * get_pokemon_summary / get_pokemon_info に委ねる）。詳しい経緯は ADR-0014。
 *
 * yakkun.com は Cloudflare チャレンジで保護されているため、素の fetch では 403 に
 * なる。r.jina.ai リーダー（`x-respond-with: html`）経由で取得する（ADR-0013 と同型）。
 *
 * 取得結果はプロセス内メモリキャッシュに `rule` ごと、TTL（24 時間）で保持する。
 * 更新周期が実測で約 1 週間であるため、短い TTL で yakkun / r.jina.ai 双方に
 * 無駄な再取得をかけない。キャッシュはプロセス内に閉じるため再起動で自然に消える。
 */

const JINA_BASE = "https://r.jina.ai/";
const RANKING_URL = "https://yakkun.com/ch/ranking.htm";
const FETCH_TIMEOUT_MS = 30_000;
/** 順位表のメモリキャッシュ TTL。更新周期（約 1 週間）に対して十分長い値（ADR-0014） */
const RANKING_TTL_MS = 24 * 60 * 60 * 1000;

export type RankingRule = "single" | "double";

export interface RankingEntry {
  rank: number;
  name: string;
}

export interface RankingData {
  rule: RankingRule;
  updatedAt: string | null;
  ranking: RankingEntry[];
  fetchedAt: number;
}

/** 使用率ランキングツールかどうか。MCP ではなくこのモジュールが処理する */
export function isRankingTool(toolName: string): boolean {
  return toolName === "get_usage_ranking";
}

/** rule ごとのメモリキャッシュ */
const cache = new Map<RankingRule, { fetchedAt: number; data: RankingData }>();

/**
 * ツールを実行し、結果を JSON 文字列で返す。
 *
 * 失敗しても例外を投げず、内容を文字列にして返す。取得に失敗しても失うのは
 * ランキング参照機能だけで、AI は一般知識で会話を続けられる（ADR-0010 と同方針）。
 */
export async function executeRankingTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    if (toolName !== "get_usage_ranking") {
      return JSON.stringify({ success: false, error: `不明なツール: ${toolName}` });
    }

    const rule = normalizeRule(args.rule);
    const data = await getRanking(rule);

    const notes = [
      "このページは順位のみを公開しており、数値の使用率（%）は存在しない。「◯%使われている」とは言わず「◯位」と答えること",
      `順位は ${data.updatedAt ?? "不明な日付"} 時点のもの。回答には必ず「◯月◯日時点」と明記すること`,
      "名前はこの表記のまま（メガ〜・(ヒスイ)・♂ など）。詳細が必要なら get_pokemon_info / get_pokemon_summary にこの名前を渡すこと",
    ];

    const pokemon = typeof args.pokemon === "string" ? args.pokemon.trim() : "";
    if (pokemon.length > 0) {
      return JSON.stringify(lookupPokemon(data, pokemon, notes));
    }

    const top = normalizeTop(args.top);
    const ranking = data.ranking.slice(0, top);
    return JSON.stringify({
      success: true,
      rule,
      updatedAt: data.updatedAt,
      total: data.ranking.length,
      ranking,
      notes,
    });
  } catch (error) {
    console.error("[ranking] get_usage_ranking の実行に失敗しました:", error);
    return JSON.stringify({
      success: false,
      error: "使用率ランキングを取得できませんでした。しばらくしてからもう一度試してください。",
    });
  }
}

/** 特定のポケモンの順位を返す。完全一致 → 部分一致の順で探す */
function lookupPokemon(
  data: RankingData,
  query: string,
  notes: string[],
): Record<string, unknown> {
  const q = query.toLowerCase();

  const exact = data.ranking.find((r) => r.name.toLowerCase() === q);
  if (exact) {
    return { success: true, rule: data.rule, updatedAt: data.updatedAt, ...exact, notes };
  }

  const partial = data.ranking.filter(
    (r) => r.name.toLowerCase().includes(q) || q.includes(r.name.toLowerCase()),
  );
  if (partial.length === 1) {
    return { success: true, rule: data.rule, updatedAt: data.updatedAt, ...partial[0], notes };
  }
  if (partial.length > 1) {
    return {
      success: false,
      error: `「${query}」は複数のポケモンに一致します。対象を絞ってください: ${partial
        .map((r) => `${r.rank}位 ${r.name}`)
        .join(" / ")}`,
    };
  }

  return {
    success: false,
    error: `「${query}」は ${data.updatedAt ?? "現在"} 時点の順位表に見つかりません。pokemon を指定せずに一覧を取得して確認してください`,
  };
}

function normalizeRule(raw: unknown): RankingRule {
  return raw === "double" ? "double" : "single";
}

function normalizeTop(raw: unknown): number {
  const n = typeof raw === "number" ? Math.floor(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return 100;
  return Math.min(n, 100);
}

/** キャッシュがあれば返し、なければ取得・解析してキャッシュする */
async function getRanking(rule: RankingRule): Promise<RankingData> {
  const cached = cache.get(rule);
  if (cached && Date.now() - cached.fetchedAt < RANKING_TTL_MS) {
    return cached.data;
  }

  const url = rule === "double" ? `${RANKING_URL}?rule=double` : RANKING_URL;
  const html = await fetchRankingHtml(url);
  const data: RankingData = {
    rule,
    updatedAt: parseUpdatedAt(html),
    ranking: parseRanking(html),
    fetchedAt: Date.now(),
  };
  cache.set(rule, { fetchedAt: Date.now(), data });
  console.log(
    `[ranking] ${rule} を取得しました: ${data.ranking.length} 件（更新日 ${data.updatedAt ?? "不明"}）`,
  );
  return data;
}

/** r.jina.ai 経由で HTML を取得する */
async function fetchRankingHtml(url: string): Promise<string> {
  const response = await fetch(JINA_BASE + url, {
    headers: { "x-respond-with": "html" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`jina reader HTTP ${response.status}`);
  }
  return decodeHtml(await response.arrayBuffer());
}

/**
 * バイト列を文字列へ戻す。
 *
 * yakkun.com は EUC-JP 配信だが、jina リーダーは UTF-8 へ変換済みで返す。
 * 万一 EUC-JP のまま届いた場合も壊さないよう、有効な UTF-8 かどうかで判定する。
 */
function decodeHtml(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("euc-jp").decode(bytes);
  }
}

/** タグを剥がし、実体参照を戻し、空白を畳んだ 1 行を得る */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** 「データの最終更新日: 2026/08/20」を抜き出す */
function parseUpdatedAt(html: string): string | null {
  const m = html.match(/データの最終更新日[^<]*<b>([^<]+)<\/b>/);
  return m ? m[1].trim() : null;
}

/**
 * 順位表（1〜100 位）を組み立てる。
 *
 * 1〜25 位は `<h2 id="N位: 名前">` の個別セクション、26〜100 位は
 * `rank_short_list`（順位＋名前のみ）に載っている。40 位のメガフラエッテは
 * 個別セクションと一覧の両方に現れるため、個別セクションは 25 位以下に絞る。
 */
function parseRanking(html: string): RankingEntry[] {
  const byRank = new Map<number, string>();

  // 1〜25 位: 個別セクションの見出し id から
  const fullRe = /<h2 id="(\d+)位: ([^"]+)">/g;
  let m: RegExpExecArray | null;
  while ((m = fullRe.exec(html)) !== null) {
    const rank = Number(m[1]);
    if (rank <= 25) byRank.set(rank, stripTags(m[2]));
  }

  // 26〜100 位: rank_short_list の各項目から
  const itemRe = /<li class="rank_short_item">([\s\S]*?)<\/li>/g;
  while ((m = itemRe.exec(html)) !== null) {
    const item = m[1];
    const rankMatch = item.match(/<span class="rank">(\d+)位<\/span>/);
    const nameMatch = item.match(/<a class="poke"[^>]*>([\s\S]*?)<\/a>/);
    if (!rankMatch || !nameMatch) continue;
    const rank = Number(rankMatch[1]);
    const name = stripTags(nameMatch[1]);
    if (name.length > 0) byRank.set(rank, name);
  }

  return Array.from(byRank.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([rank, name]) => ({ rank, name }));
}

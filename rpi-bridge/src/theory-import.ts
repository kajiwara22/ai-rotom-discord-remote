/**
 * ポケモン徹底攻略 (yakkun.com) の育成論の取り込み。
 *
 * yakkun.com は Cloudflare チャレンジで保護されており、素の fetch では 403 になる。
 * そこで r.jina.ai リーダー（`x-respond-with: html`）を主とし、到達できない場合は
 * Playwright ヘッドレスへフォールバックする。Playwright は Pi に未導入のため、
 * フォールバック経路は導入済みの環境でのみ動く（導入方法は ADR-0013 参照）。
 *
 * 育成論ページの構造は投稿ごとに必ずしも一律ではないため、解析はベストエフォート。
 * 取れなかったフィールドは null にし、考察本文（articleBody）は必ず全文を保存する。
 * 詳しい経緯は docs/adr/ADR-0013.md を参照。
 */
import { getDb } from "./db.js";
import { createRequire } from "node:module";

const JINA_BASE = "https://r.jina.ai/";
const FETCH_TIMEOUT_MS = 30_000;
const PLAYWRIGHT_NAV_TIMEOUT_MS = 60_000;

/** SP 配分。取れなかった項目はキー自体を持たない */
interface Evs {
  hp?: number;
  atk?: number;
  def?: number;
  spa?: number;
  spd?: number;
  spe?: number;
}

/** 取り込み結果の 1 件分 */
export interface TheoryData {
  url: string;
  pokemon: string | null;
  title: string | null;
  nature: string | null;
  ability: string | null;
  item: string | null;
  evs: Evs | null;
  moves: string[];
  rule: string | null;
  role: string | null;
  body: string | null;
  fetchedAt: number;
}

/** 育成論ツールかどうか。MCP ではなくこのモジュールが処理する */
export function isTheoryTool(toolName: string): boolean {
  return toolName === "import_theory_from_url" || toolName === "get_theory";
}

/**
 * ツールを実行し、結果を JSON 文字列で返す。
 *
 * 失敗しても例外を投げず、内容を文字列にして返す。取得に失敗しても失うのは
 * 取り込み機能だけで、AI は一般知識で会話を続けられる（ADR-0010 と同方針）。
 */
export async function executeTheoryTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    if (toolName === "import_theory_from_url") {
      const url = args.url;
      if (typeof url !== "string" || url.trim() === "") {
        return JSON.stringify({ success: false, error: "url を指定してください" });
      }

      const normalized = normalizeUrl(url);
      const html = await fetchTheoryHtml(normalized);
      const theory = parseTheoryHtml(html, normalized);
      saveTheory(theory);

      return JSON.stringify({
        success: true,
        theory,
        notes: [
          "取り込んだ型（性格・特性・持ち物・SP・技）は、そのまま analyze_matchup / calculate_damage_single / analyze_selection などのツールに渡して使える",
          "育成論に登場するポケモン・技・特性・持ち物がポケモンチャンピオンズに収録されているかは、対応するツール（get_pokemon_info / get_move_info など）で確認してから回答すること",
          "SP 配分が合計 66 に満たない場合は投稿者の配分のまま扱い、補正しない",
        ],
      });
    }

    if (toolName === "get_theory") {
      const url = args.url;
      if (typeof url !== "string" || url.trim() === "") {
        return JSON.stringify({ success: false, error: "url を指定してください" });
      }

      const theory = getTheoryByUrl(normalizeUrl(url));
      if (theory === null) {
        return JSON.stringify({
          success: false,
          error: "この URL の育成論はまだ取り込まれていません。import_theory_from_url を呼んで取り込んでください",
        });
      }
      return JSON.stringify({ success: true, theory });
    }

    return JSON.stringify({ success: false, error: `不明なツール: ${toolName}` });
  } catch (error) {
    console.error(`[theory] ${toolName} の実行に失敗しました:`, error);
    return JSON.stringify({
      success: false,
      error: "育成論を取得できませんでした。URL を確認してもう一度試してください。",
    });
  }
}

/** URL を正規化する。yakkun.com の育成論でなければ例外を投げる */
function normalizeUrl(input: string): string {
  let raw = input.trim();
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`URL を解釈できませんでした: ${input}`);
  }

  if (!/yakkun\.com$/i.test(parsed.hostname)) {
    throw new Error(`yakkun.com の育成論 URL ではありません: ${input}`);
  }
  if (!parsed.pathname.startsWith("/ch/theory/")) {
    throw new Error(`育成論の URL ではありません（/ch/theory/ 配下を指定してください）: ${input}`);
  }

  // フラグメント（#持ち物 など）はページ特定に関係ないので落とす
  parsed.hash = "";
  return parsed.toString();
}

/** r.jina.ai 経由で HTML を取得し、失敗したら Playwright へフォールバックする */
async function fetchTheoryHtml(url: string): Promise<string> {
  try {
    const response = await fetch(JINA_BASE + url, {
      headers: { "x-respond-with": "html" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.ok) {
      return decodeHtml(await response.arrayBuffer());
    }
    console.warn(`[theory] jina reader HTTP ${response.status}。Playwright へフォールバックします`);
  } catch (error) {
    console.warn(`[theory] jina reader に到達できませんでした。Playwright へフォールバックします:`, error);
  }
  return fetchTheoryHtmlWithPlaywright(url);
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

/** Playwright が導入済みの環境向けのフォールバック取得 */
async function fetchTheoryHtmlWithPlaywright(url: string): Promise<string> {
  // playwright は未導入の環境では存在しない。型定義を持たないオプショナル依存のため、
  // createRequire で実行時にだけ解決し、未導入なら分かりやすいメッセージで失敗させる
  let chromium: {
    launch(): Promise<{
      newPage(): Promise<{
        goto(url: string, options: { waitUntil: string; timeout: number }): Promise<unknown>;
        waitForLoadState(state: string, options?: { timeout: number }): Promise<void>;
        content(): Promise<string>;
      }>;
      close(): Promise<void>;
    }>;
  };
  try {
    const require = createRequire(import.meta.url);
    chromium = require("playwright").chromium;
  } catch {
    throw new Error(
      "育成論を取得できませんでした（jina reader に到達できず、Playwright も未導入です）。" +
        "Pi に `npm i playwright && npx playwright install --with-deps chromium` を実行してください",
    );
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: PLAYWRIGHT_NAV_TIMEOUT_MS });
    // Cloudflare チャレンジ通過を待つ。失敗しても取得済みの内容で続行する
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
    return await page.content();
  } finally {
    await browser.close();
  }
}

// ========== 解析（ベストエフォート） ==========

/** `<br>` を改行に変えてからタグを剥がし、実体参照を戻す */
function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** ヘッダ値（性格・特性など）用に、空白を畳んだ 1 行の文字列を得る */
function inlineText(html: string): string {
  return stripTags(html).replace(/\s+/g, " ").trim();
}

/** `<dt>...` の直後にある `<dd>` の内部 HTML を取り出す */
function ddAfter(html: string, dtPattern: string): string | null {
  const dtIndex = html.indexOf(dtPattern);
  if (dtIndex < 0) return null;
  const afterDt = html.slice(dtIndex + dtPattern.length);
  const ddMatch = afterDt.match(/<dd[^>]*>([\s\S]*?)<\/dd>/);
  return ddMatch ? ddMatch[1] : null;
}

/** dd 内の最初の `<a>` のテキスト（性格・特性・持ち物・ルール・役割で使う） */
function firstAnchorText(ddHtml: string): string | null {
  const m = ddHtml.match(/<a[^>]*>([\s\S]*?)<\/a>/);
  if (!m) return null;
  const text = inlineText(m[1]);
  return text.length > 0 ? text : null;
}

/** 能力ポイント(SP) の表記（例: HP:18 / 攻撃:17 / ...）を Evs に変換する */
function parseSp(ddHtml: string): Evs | null {
  const beforeHr = ddHtml.split("<hr")[0];
  const text = inlineText(beforeHr);
  const evs: Evs = {};

  const pick = (label: string, key: keyof Evs): void => {
    const m = text.match(new RegExp(`${label}\\s*[:：]\\s*(\\d+)`, "i"));
    if (m) evs[key] = Number(m[1]);
  };
  pick("特攻", "spa");
  pick("特防", "spd");
  pick("攻撃", "atk");
  pick("防御", "def");
  pick("素早", "spe");
  pick("HP", "hp");

  return Object.keys(evs).length > 0 ? evs : null;
}

/** 覚えさせる技（move_dd 内の .name リンク）を列挙する */
function parseMoves(ddHtml: string): string[] {
  const moves: string[] = [];
  const re = /<div class="name">\s*<a[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ddHtml)) !== null) {
    const name = inlineText(m[1]);
    if (name) moves.push(name);
  }
  return moves;
}

/** タイトルタグからポケモン名を取り出す（「◯◯育成論」の前半） */
function parsePokemon(html: string): string | null {
  const m = html.match(/<title>([\s\S]*?)<\/title>/);
  if (!m) return null;
  const text = inlineText(m[1]);
  const idx = text.indexOf("育成論");
  const name = idx > 0 ? text.slice(0, idx).trim() : "";
  return name.length > 0 ? name : null;
}

/** 育成論タイトルは最初の `<h2>` に書かれている */
function parseTitle(html: string): string | null {
  const m = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
  if (!m) return null;
  const text = inlineText(m[1]);
  return text.length > 0 ? text : null;
}

/** 考察本文（articleBody）。h3 を節見出しに、p を段落にし、改行を保つ */
function extractBody(html: string): string | null {
  const anchor = html.indexOf('id="consideration"');
  if (anchor < 0) return null;
  const articleStart = html.indexOf('itemprop="articleBody"', anchor);
  if (articleStart < 0) return null;

  let seg = html.slice(articleStart);
  const end = seg.indexOf("投稿日時");
  if (end >= 0) seg = seg.slice(0, end);

  const parts: string[] = [];
  const re = /<h3[^>]*>([\s\S]*?)<\/h3>|<p[^>]*>([\s\S]*?)<\/p>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(seg)) !== null) {
    const isHeading = m[1] !== undefined;
    const text = stripTags(m[1] ?? m[2])
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n");
    if (!text) continue;
    parts.push(isHeading ? `■ ${text}` : text);
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}

function parseTheoryHtml(html: string, url: string): TheoryData {
  const nature = (() => {
    const dd = ddAfter(html, "<dt>性格</dt>");
    return dd === null ? null : firstAnchorText(dd);
  })();
  const ability = (() => {
    const dd = ddAfter(html, "<dt>特性</dt>");
    return dd === null ? null : firstAnchorText(dd);
  })();
  const item = (() => {
    const dd = ddAfter(html, "<dt>持ち物</dt>");
    return dd === null ? null : firstAnchorText(dd);
  })();
  const evs = (() => {
    const dd = ddAfter(html, "<dt>能力ポイント(努力値配分)");
    return dd === null ? null : parseSp(dd);
  })();
  const moves = (() => {
    const dd = ddAfter(html, "<dt>覚えさせる技</dt>");
    return dd === null ? [] : parseMoves(dd);
  })();
  const rule = (() => {
    const dd = ddAfter(html, "<dt>ルール</dt>");
    return dd === null ? null : firstAnchorText(dd);
  })();
  const role = (() => {
    const dd = ddAfter(html, "<dt>このポケモンの役割</dt>");
    return dd === null ? null : firstAnchorText(dd);
  })();

  return {
    url,
    pokemon: parsePokemon(html),
    title: parseTitle(html),
    nature,
    ability,
    item,
    evs,
    moves,
    rule,
    role,
    body: extractBody(html),
    fetchedAt: Date.now(),
  };
}

// ========== 保存・参照 ==========

interface TheoryRow {
  url: string;
  pokemon: string | null;
  title: string | null;
  nature: string | null;
  ability: string | null;
  item: string | null;
  evs_json: string | null;
  moves_json: string | null;
  rule: string | null;
  role: string | null;
  body_text: string | null;
  fetched_at: number;
}

function saveTheory(data: TheoryData): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO theory_refs
       (url, pokemon, title, nature, ability, item, evs_json, moves_json, rule, role, body_text, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(url) DO UPDATE SET
       pokemon = excluded.pokemon,
       title = excluded.title,
       nature = excluded.nature,
       ability = excluded.ability,
       item = excluded.item,
       evs_json = excluded.evs_json,
       moves_json = excluded.moves_json,
       rule = excluded.rule,
       role = excluded.role,
       body_text = excluded.body_text,
       fetched_at = excluded.fetched_at`,
  ).run(
    data.url,
    data.pokemon,
    data.title,
    data.nature,
    data.ability,
    data.item,
    data.evs === null ? null : JSON.stringify(data.evs),
    JSON.stringify(data.moves),
    data.rule,
    data.role,
    data.body,
    data.fetchedAt,
  );
}

function getTheoryByUrl(url: string): TheoryData | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM theory_refs WHERE url = ?").get(url) as
    | TheoryRow
    | undefined;
  if (!row) return null;

  return {
    url: row.url,
    pokemon: row.pokemon,
    title: row.title,
    nature: row.nature,
    ability: row.ability,
    item: row.item,
    evs: row.evs_json === null ? null : (JSON.parse(row.evs_json) as Evs),
    moves: row.moves_json === null ? [] : (JSON.parse(row.moves_json) as string[]),
    rule: row.rule,
    role: row.role,
    body: row.body_text,
    fetchedAt: row.fetched_at,
  };
}

/**
 * docs/ 配下の Markdown を家庭内 LAN 向けに読むための配信（ADR-0028）。
 *
 * 設計の要点:
 * - 読み取り専用。docs/ の外へは絶対に出さない（パス検証は resolve + 前方一致）
 * - 目次は毎回 docs/ を走査して組み立てる。ファイルを足せば目次に出る（固定リストを持たない）
 * - 見出し ID は本文（h2）の出現順 `s1`, `s2`, ... で、ビューア側の付番と一致させる
 * - Markdown は text/markdown のまま返し、描画はブラウザ側の marked に任せる
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { ServerResponse } from "node:http";

/** 既定はリポジトリ直下の docs/。起動ディレクトリが違う場合は DOCS_DIR で上書きする */
const DOCS_DIR = resolve(process.env.DOCS_DIR ?? join(process.cwd(), "..", "docs"));
const VIEWER_DIR = resolve(process.cwd(), "public", "docs");

/** 目次に載せるディレクトリ。並び順がそのまま目次の並び順になる */
const DOC_GROUPS = ["concepts", "adr"] as const;

const VIEWER_FILES: Record<string, { file: string; type: string }> = {
  "/docs/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/docs/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/docs/_app.css": { file: "_app.css", type: "text/css; charset=utf-8" },
  "/docs/_app.js": { file: "_app.js", type: "application/javascript; charset=utf-8" },
  "/docs/_manifest.webmanifest": { file: "_manifest.webmanifest", type: "application/manifest+json" },
  "/docs/_icon-180.png": { file: "_icon-180.png", type: "image/png" },
};

interface Heading {
  id: string;
  text: string;
}

interface DocEntry {
  /** docs/ からの相対パス（例: concepts/メガリザードンYv0.1.md） */
  path: string;
  title: string;
  updated: string;
  headings: Heading[];
}

/** 見出しテキストから装飾を落とす（目次にそのまま出せる形にする） */
function stripInline(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\*([^*]*)\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * h2 だけを拾う。ビューアも h2 の出現順に s1.. を振るため、番号が一致する。
 * コードブロック内の `## ` を拾わないようフェンスを追跡する。
 */
function extractHeadings(md: string): Heading[] {
  const headings: Heading[] = [];
  let inFence = false;

  for (const line of md.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) {
      headings.push({ id: `s${headings.length + 1}`, text: stripInline(match[1]) });
    }
  }

  return headings;
}

function extractTitle(md: string, fallback: string): string {
  const match = /^#\s+(.+?)\s*#*\s*$/m.exec(md);
  return match ? stripInline(match[1]) : fallback;
}

function toDate(mtimeMs: number): string {
  const d = new Date(mtimeMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** docs/ を走査して目次を作る。グループ内は更新の新しい順 */
function buildToc(): { groups: { group: string; docs: DocEntry[] }[] } {
  const groups: { group: string; docs: DocEntry[] }[] = [];

  for (const group of DOC_GROUPS) {
    const dir = join(DOCS_DIR, group);
    let names: string[];
    try {
      names = readdirSync(dir).filter((name) => name.endsWith(".md"));
    } catch {
      continue;
    }

    const docs: DocEntry[] = [];
    for (const name of names) {
      const full = join(dir, name);
      let md: string;
      let mtimeMs: number;
      try {
        md = readFileSync(full, "utf8");
        mtimeMs = statSync(full).mtimeMs;
      } catch {
        continue;
      }
      const fallbackTitle = name.replace(/\.md$/, "");
      docs.push({
        path: `${group}/${name}`,
        title: extractTitle(md, fallbackTitle),
        updated: toDate(mtimeMs),
        headings: extractHeadings(md),
      });
    }

    docs.sort((a, b) => b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title, "ja"));
    groups.push({ group, docs });
  }

  return { groups };
}

/** docs/ 配下の Markdown だけを返す。外に出るパスは 403 */
function readDoc(encodedRel: string): { status: number; body?: string } {
  let rel: string;
  try {
    rel = decodeURIComponent(encodedRel);
  } catch {
    return { status: 400 };
  }

  if (!rel.endsWith(".md")) return { status: 404 };

  const target = resolve(DOCS_DIR, rel);
  if (target !== DOCS_DIR && !target.startsWith(DOCS_DIR + sep)) return { status: 403 };

  try {
    return { status: 200, body: readFileSync(target, "utf8") };
  } catch {
    return { status: 404 };
  }
}

function send(res: ServerResponse, status: number, type: string, body: string | Buffer, cache = "no-cache"): void {
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": cache,
  });
  res.end(body);
}

/**
 * /docs 系のリクエストを処理したら true を返す。
 * 呼び出し側（index.ts）は true のとき return する。
 */
export function handleDocs(url: string, res: ServerResponse): boolean {
  const pathname = url.split("?")[0];
  if (pathname !== "/docs" && !pathname.startsWith("/docs/")) return false;

  if (pathname === "/docs") {
    res.writeHead(301, { Location: "/docs/" });
    res.end();
    return true;
  }

  const viewer = VIEWER_FILES[pathname];
  if (viewer) {
    try {
      send(res, 200, viewer.type, readFileSync(join(VIEWER_DIR, viewer.file)));
    } catch {
      send(res, 404, "text/plain; charset=utf-8", "Not found");
    }
    return true;
  }

  if (pathname === "/docs/_toc.json") {
    try {
      send(res, 200, "application/json; charset=utf-8", JSON.stringify(buildToc()), "no-store");
    } catch {
      send(res, 500, "application/json; charset=utf-8", JSON.stringify({ error: "目次の生成に失敗しました" }));
    }
    return true;
  }

  const mdPrefix = "/docs/md/";
  if (pathname.startsWith(mdPrefix)) {
    const result = readDoc(pathname.slice(mdPrefix.length));
    if (result.status !== 200) {
      send(res, result.status, "text/plain; charset=utf-8", "Not found");
      return true;
    }
    send(res, 200, "text/markdown; charset=utf-8", result.body ?? "");
    return true;
  }

  send(res, 404, "text/plain; charset=utf-8", "Not found");
  return true;
}

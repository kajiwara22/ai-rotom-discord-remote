/**
 * 対戦振り返りの記録（ADR-0017）。
 *
 * 検品を通った振り返りを matchId 単位で SQLite に保存し、セッションが
 * 失効しても「あの対戦の振り返り」を引き出せるようにする。
 * `theory_refs`（ADR-0013）と同じ、DB を直接読むブリッジ側ツールの形をとる。
 */
import { getDb } from "./db.js";

/** 対戦振り返りツールかどうか。MCP ではなくこのモジュールが処理する */
export function isReviewTool(toolName: string): boolean {
  return toolName === "get_match_review";
}

export interface MatchReview {
  matchId: string;
  reviewText: string;
  improvements: string | null;
  nextAction: string | null;
  reviewedAt: number;
}

interface MatchReviewRow {
  match_id: string;
  review_text: string;
  improvements: string | null;
  next_action: string | null;
  reviewed_at: number;
}

/** 振り返りを upsert する。同じ対戦を振り返り直したら最新で上書きする */
export function saveMatchReview(review: MatchReview): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO match_reviews (match_id, review_text, improvements, next_action, reviewed_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(match_id) DO UPDATE SET
       review_text = excluded.review_text,
       improvements = excluded.improvements,
       next_action = excluded.next_action,
       reviewed_at = excluded.reviewed_at`,
  ).run(
    review.matchId,
    review.reviewText,
    review.improvements,
    review.nextAction,
    review.reviewedAt,
  );
}

function loadMatchReview(matchId: string): MatchReview | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM match_reviews WHERE match_id = ?").get(matchId) as
    | MatchReviewRow
    | undefined;
  if (!row) return null;

  return {
    matchId: row.match_id,
    reviewText: row.review_text,
    improvements: row.improvements,
    nextAction: row.next_action,
    reviewedAt: row.reviewed_at,
  };
}

/** 見出しに基づいて節を抜き出す（なければ null）。ベストエフォート */
function sectionAfter(reply: string, headings: string[]): string | null {
  const lines = reply.split("\n");
  for (const heading of headings) {
    const idx = lines.findIndex((l) => l.trim().startsWith(heading));
    if (idx < 0) continue;
    const content: string[] = [];
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^#{1,3}\s/.test(lines[i])) break; // 次の見出しで終了
      content.push(lines[i]);
    }
    const text = content.join("\n").trim();
    if (text.length > 0) return text;
  }
  return null;
}

/**
 * 回答本文から保存用の記録を組み立てる。
 *
 * improvements / next_action は完成品の形（ADR-0017）の見出しから取り出す
 * ベストエフォートで、取れなければ null。原文（reviewText）は必ず残す。
 */
export function buildMatchReview(matchId: string, reply: string): MatchReview {
  return {
    matchId,
    reviewText: reply,
    improvements: sectionAfter(reply, ["## 改善候補", "### 改善候補", "## 改善"]),
    nextAction: sectionAfter(reply, ["## 次の一手", "### 次の一手", "## 次にやること"]),
    reviewedAt: Date.now(),
  };
}

/**
 * 対戦振り返りツールを実行する。
 *
 * 失敗しても例外を投げず、内容を JSON 文字列にして返す。記録が無いだけで
 * 会話は止めない（ADR-0010 と同方針）。
 */
export async function executeReviewTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    if (toolName !== "get_match_review") {
      return JSON.stringify({ success: false, error: `不明なツール: ${toolName}` });
    }

    const matchId = args.matchId;
    if (typeof matchId !== "string" || matchId.trim() === "") {
      return JSON.stringify({ success: false, error: "matchId を指定してください" });
    }

    const review = loadMatchReview(matchId.trim());
    if (review === null) {
      return JSON.stringify({
        success: false,
        error:
          "この対戦の振り返りはまだ保存されていません。list_matches → get_match で振り返ると自動で保存されます",
      });
    }

    return JSON.stringify({
      success: true,
      match_id: review.matchId,
      review_text: review.reviewText,
      improvements: review.improvements,
      next_action: review.nextAction,
      reviewed_at: review.reviewedAt,
      notes: [
        "この記録は過去の振り返りで、対戦記録（選出・構築）そのものではない。対戦の事実が必要なら get_match を呼ぶこと",
      ],
    });
  } catch (error) {
    console.error("[review] get_match_review の実行に失敗しました:", error);
    return JSON.stringify({
      success: false,
      error: "振り返り記録を取得できませんでした。しばらくしてからもう一度試してください。",
    });
  }
}

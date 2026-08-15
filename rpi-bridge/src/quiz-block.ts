/**
 * 3 択クイズの構造ブロックを AI 応答から取り出す（ADR-0011）。
 *
 * AI には「人が読む本文」に続けて ```quiz フェンスの JSON を書かせる。
 * ここで抽出したものを Web API の `quiz` フィールドに載せ、本文からは取り除く。
 *
 * 抽出に失敗したときは**本文を一切いじらない**。取り除いてから失敗に気づくと
 * 問題そのものが消え、利用者の手元に何も残らないためである。ブロックが本文に
 * 残ればコードブロックとして表示され、少なくとも問題文は読める。
 */

/** クイズ 1 問。Web API に載るためフィールドは snake_case */
export interface QuizQuestion {
  question: string;
  choices: string[];
  /** 正解の選択肢の位置（0 始まり） */
  answer_index: number;
  /** 選んだ直後に出す 1〜2 文の解説。空文字のこともある */
  explanation: string;
}

/** 3 択で固定する。増減させる場合はクライアントの選択肢描画も併せて見直すこと */
const CHOICE_COUNT = 3;
/** 想定は 5 問。多すぎる応答は形式が壊れている可能性が高いので弾く */
const MAX_QUESTIONS = 10;

const QUIZ_BLOCK = /```quiz[^\n]*\n([\s\S]*?)```/;

export interface ExtractedQuiz {
  /** 表示用の本文。抽出できたときだけブロックが取り除かれる */
  text: string;
  /** 抽出できたクイズ。形式が不正なら null */
  quiz: QuizQuestion[] | null;
}

export function extractQuiz(reply: string): ExtractedQuiz {
  const match = QUIZ_BLOCK.exec(reply);
  if (!match) return { text: reply, quiz: null };

  const quiz = parseQuiz(match[1]);
  if (!quiz) {
    console.warn("[quiz] ブロックを解釈できませんでした。本文としてそのまま表示します");
    return { text: reply, quiz: null };
  }

  const text = (reply.slice(0, match.index) + reply.slice(match.index + match[0].length)).trim();
  console.log(`[quiz] ${quiz.length} 問を抽出しました`);
  return { text, quiz };
}

/**
 * 1 問でも形式が崩れていれば全体を捨てる。
 * 壊れた問題だけ落として残りを使うと、正解が誤ったまま出題される余地が残る。
 */
function parseQuiz(raw: string): QuizQuestion[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const list = Array.isArray(parsed)
    ? parsed
    : (parsed as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_QUESTIONS) return null;

  const questions: QuizQuestion[] = [];
  for (const item of list) {
    const question = toQuestion(item);
    if (!question) return null;
    questions.push(question);
  }
  return questions;
}

function toQuestion(value: unknown): QuizQuestion | null {
  if (value === null || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;

  const question = typeof item.question === "string" ? item.question.trim() : "";
  if (!question) return null;

  const choices = Array.isArray(item.choices)
    ? item.choices
        .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
        .map((c) => c.trim())
    : [];
  if (choices.length !== CHOICE_COUNT) return null;

  // 正解は 1〜3 で書かせる。0 始まりで書かれた場合と見分ける手段がないため、
  // 範囲外は不正として扱い、推測で補正しない
  const answer = item.answer;
  if (
    typeof answer !== "number" ||
    !Number.isInteger(answer) ||
    answer < 1 ||
    answer > CHOICE_COUNT
  ) {
    return null;
  }

  const explanation = typeof item.explanation === "string" ? item.explanation.trim() : "";

  return { question, choices, answer_index: answer - 1, explanation };
}

/**
 * 保存済みの応答を、履歴表示用の文字列に変換する。
 *
 * DB にはブロックを含む原文が残っている（AI に自分の出題を思い出させるため）。
 * そのまま返すと JSON が画面に出るので、読める Markdown に置き換える。
 * ブロックがなければ原文をそのまま返す。
 */
export function renderStoredReply(content: string): string {
  const { text, quiz } = extractQuiz(content);
  if (!quiz) return content;

  const markdown = quizToMarkdown(quiz);
  return text ? `${text}\n\n${markdown}` : markdown;
}

/**
 * 過去ログでは選択肢ボタンを復元しない（押せる問題は常に最新の 1 問だけ、ADR-0011）。
 * 読み返せるよう、正解の位置が分かる形で残す。
 */
function quizToMarkdown(quiz: QuizQuestion[]): string {
  return quiz
    .map((q, i) => {
      const choices = q.choices
        .map((c, j) => `${j + 1}. ${c}${j === q.answer_index ? " ✅" : ""}`)
        .join("\n");
      const explanation = q.explanation ? `\n\n${q.explanation}` : "";
      return `**Q${i + 1}. ${q.question}**\n\n${choices}${explanation}`;
    })
    .join("\n\n");
}

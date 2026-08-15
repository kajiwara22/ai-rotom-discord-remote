/**
 * 対戦記録の読み出し。
 *
 * `pokemon-champions-chapter` が解析結果を Parquet として R2 に置いており、
 * それを DuckDB の httpfs 拡張で直接クエリする。ローカルへ同期しないため、
 * 解析側が差し替えた瞬間から新しいデータで答えられる。
 * 詳しい経緯は docs/adr/ADR-0010.md を参照。
 *
 * このデータに行動ログ（技・ダメージ・ターン推移）は含まれない。
 * 扱えるのは選出フェーズまでであり、その制約は応答の notes で AI に伝える。
 */
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";

const BUCKET = process.env.R2_BUCKET_NAME ?? "pcc-data";
const OBJECT_KEY = process.env.PCC_PARQUET_KEY ?? "index/matches.parquet";

/** YouTube の動画 ID。11 文字の URL セーフな文字列 */
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
/** `{videoId}_{startSec}` 形式 */
const MATCH_ID_PATTERN = /^[A-Za-z0-9_-]{11}_\d+$/;

/** URL の中から動画 ID が現れる位置。watch?v= / youtu.be / live / shorts / embed */
const VIDEO_ID_IN_URL = /(?:[?&]v=|youtu\.be\/|\/live\/|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/;

/** Parquet の 1 行。解析側のスキーマと 1 対 1 で対応する */
interface MatchRow {
  matchId: string;
  videoId: string;
  startSec: number;
  endSec: number | null;
  battleFormat: string;
  result: string;
  platform: string;
  title: string;
  videoTitle: string;
  publishedAt: string;
  opponentTeam: string[];
  opponentLead: string[];
  opponentSelection: string[];
  selfLead: string[];
  selfSelection: string[];
}

/**
 * 動画 ID を取り出す。ID そのものと YouTube の各種 URL を受け付ける。
 *
 * URL の解釈を AI に任せず、ここで引き受けている。`youtu.be` 形式や
 * `&t=` 付きの URL を渡されたときに、形式によって失敗する余地を残さないため。
 */
export function normalizeVideoId(input: string): string | undefined {
  const trimmed = input.trim();
  if (VIDEO_ID_PATTERN.test(trimmed)) return trimmed;
  const matched = trimmed.match(VIDEO_ID_IN_URL);
  return matched ? matched[1] : undefined;
}

/** SQL リテラルに埋める文字列をエスケープする */
function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** R2 のエンドポイント。プロトコルの有無どちらの指定も受け付ける */
function normalizeEndpoint(raw: string): string {
  return raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

let connectionPromise: Promise<DuckDBConnection> | undefined;

/**
 * DuckDB の接続を用意する。`LOAD` と `CREATE SECRET` はここで一度だけ実行し、
 * ツール呼び出しのたびには行わない。
 *
 * `INSTALL httpfs` は実行時ではなく Pi のセットアップ手順で済ませる約束になっている。
 * ネットワークが不調な再起動で、サーバー全体の起動が拡張のダウンロードに
 * 引きずられるのを避けるため。
 */
async function connect(): Promise<DuckDBConnection> {
  const endpoint = process.env.R2_ENDPOINT_URL ?? "";
  const keyId = process.env.R2_ACCESS_KEY_ID ?? "";
  const secret = process.env.R2_SECRET_ACCESS_KEY ?? "";

  const missing = [
    ["R2_ENDPOINT_URL", endpoint],
    ["R2_ACCESS_KEY_ID", keyId],
    ["R2_SECRET_ACCESS_KEY", secret],
  ]
    .filter(([, value]) => value === "")
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`対戦記録の参照に必要な環境変数が未設定です: ${missing.join(", ")}`);
  }

  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();

  try {
    await connection.run("LOAD httpfs");
  } catch (error) {
    throw new Error(
      `httpfs 拡張を読み込めませんでした（セットアップ時の INSTALL httpfs; が未実行の可能性があります）: ${String(error)}`,
    );
  }

  // R2 は S3 互換だが path style を要求する
  await connection.run(
    `CREATE SECRET (
       TYPE s3,
       KEY_ID ${quote(keyId)},
       SECRET ${quote(secret)},
       ENDPOINT ${quote(normalizeEndpoint(endpoint))},
       REGION 'auto',
       URL_STYLE 'path'
     )`,
  );

  console.log(`[match] DuckDB 接続を初期化しました (s3://${BUCKET}/${OBJECT_KEY})`);
  return connection;
}

/** 接続を使い回す。初期化に失敗した場合は次回やり直せるよう握らない */
function getConnection(): Promise<DuckDBConnection> {
  if (connectionPromise === undefined) {
    connectionPromise = connect().catch((error: unknown) => {
      connectionPromise = undefined;
      throw error;
    });
  }
  return connectionPromise;
}

async function query(sql: string, values: string[]): Promise<MatchRow[]> {
  const connection = await getConnection();
  const reader = await connection.runAndReadAll(sql, values);
  return reader.getRowObjectsJson() as unknown as MatchRow[];
}

/** Parquet の場所。利用者の入力は含まれないため、そのまま SQL に埋める */
const SOURCE = `read_parquet(${quote(`s3://${BUCKET}/${OBJECT_KEY}`)})`;

/** 動画の該当位置を指す URL */
function watchUrl(videoId: string, startSec: number): string {
  return `https://youtu.be/${videoId}?t=${startSec}`;
}

/** 空配列は「記録がない」ことを意味するため、値がある場合だけ返す */
function presentOrUndefined(list: string[] | undefined): string[] | undefined {
  return list !== undefined && list.length > 0 ? list : undefined;
}

/**
 * 1 つの動画に含まれる対戦の一覧。
 *
 * 応答は 1 動画に閉じている。全件を横断して返す形に変えると、
 * 整形なしで素通しできるサイズ（ADR-0006）を超えるため注意すること。
 */
export async function listMatches(video: string): Promise<unknown> {
  const videoId = normalizeVideoId(video);
  if (videoId === undefined) {
    return {
      success: false,
      error: `動画を特定できませんでした: ${video}（YouTube の URL か 11 文字の動画 ID を渡してください）`,
    };
  }

  const rows = await query(
    `SELECT matchId, title, result, startSec, opponentLead, videoTitle, publishedAt
     FROM ${SOURCE}
     WHERE videoId = $1
     ORDER BY startSec`,
    [videoId],
  );

  if (rows.length === 0) {
    return {
      success: false,
      error: `この動画の対戦記録は見つかりませんでした（videoId: ${videoId}）。まだ解析されていない可能性があります。`,
    };
  }

  return {
    videoId,
    videoTitle: rows[0].videoTitle,
    publishedAt: rows[0].publishedAt,
    matches: rows.map((row) => ({
      matchId: row.matchId,
      title: row.title,
      result: row.result,
      opponentLead: row.opponentLead,
      url: watchUrl(videoId, row.startSec),
    })),
    notes: "振り返りたい対戦を選び、matchId を指定して get_match を呼ぶ",
  };
}

/** 1 つの対戦の詳細 */
export async function getMatch(matchId: string): Promise<unknown> {
  const trimmed = matchId.trim();
  if (!MATCH_ID_PATTERN.test(trimmed)) {
    return {
      success: false,
      error: `matchId の形式が不正です: ${matchId}（list_matches が返した matchId をそのまま渡してください）`,
    };
  }

  const rows = await query(`SELECT * FROM ${SOURCE} WHERE matchId = $1`, [trimmed]);
  if (rows.length === 0) {
    return {
      success: false,
      error: `対戦記録が見つかりませんでした（matchId: ${trimmed}）`,
    };
  }

  const row = rows[0];
  const notes = [
    "この記録に技・ダメージ・ターン推移は含まれない。選出フェーズまでを扱うこと",
    "selfSelection は選出した 4 体。控えの 2 体は記録されていないため、必要なら保存済みパーティを参照すること",
  ];
  if (presentOrUndefined(row.opponentSelection) === undefined) {
    notes.push("相手の選出 4 体は未記録。相手について分かるのは構築 6 体と先発 2 体のみ");
  }

  return {
    matchId: row.matchId,
    title: row.title,
    videoTitle: row.videoTitle,
    publishedAt: row.publishedAt,
    battleFormat: row.battleFormat,
    result: row.result,
    url: watchUrl(row.videoId, row.startSec),
    opponentTeam: row.opponentTeam,
    opponentLead: row.opponentLead,
    opponentSelection: presentOrUndefined(row.opponentSelection),
    selfLead: row.selfLead,
    selfSelection: row.selfSelection,
    notes,
  };
}

/**
 * R2 の Parquet に到達できるかを件数で確かめる。
 * セットアップ時の疎通確認に使う（src/setup-duckdb.ts）。
 */
export async function countMatches(): Promise<number> {
  const connection = await getConnection();
  const reader = await connection.runAndReadAll(`SELECT count(*) AS n FROM ${SOURCE}`);
  const rows = reader.getRowObjectsJson() as unknown as { n: number | string }[];
  return Number(rows[0].n);
}

/** 対戦記録ツールかどうか。MCP ではなくこのモジュールが処理する */
export function isMatchTool(toolName: string): boolean {
  return toolName === "list_matches" || toolName === "get_match";
}

/**
 * 対戦記録ツールを実行する。
 *
 * 失敗しても例外を投げず、内容を JSON 文字列にして返す。R2 に到達できない場合に
 * 失うのは振り返り機能だけで、AI は一般知識で会話を続けられる（ADR-0010）。
 */
export async function executeMatchTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    if (toolName === "list_matches") {
      const video = args.video;
      if (typeof video !== "string" || video.trim() === "") {
        return JSON.stringify({ success: false, error: "video を指定してください" });
      }
      return JSON.stringify(await listMatches(video));
    }

    const matchId = args.matchId;
    if (typeof matchId !== "string" || matchId.trim() === "") {
      return JSON.stringify({ success: false, error: "matchId を指定してください" });
    }
    return JSON.stringify(await getMatch(matchId));
  } catch (error) {
    // 詳細はログに残し、AI には対処可能な粒度だけを返す
    console.error(`[match] ${toolName} の実行に失敗しました:`, error);
    return JSON.stringify({
      success: false,
      error: "対戦記録を取得できませんでした。今は対戦の振り返りができません。",
    });
  }
}

/** プロセス終了時に接続を閉じる */
export async function closeMatchRepository(): Promise<void> {
  if (connectionPromise === undefined) return;
  try {
    const connection = await connectionPromise;
    connection.closeSync();
  } catch {
    // 初期化に失敗していた場合は閉じるものがない
  }
  connectionPromise = undefined;
}

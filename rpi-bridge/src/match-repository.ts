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
 *
 * 解析側が自分のパーティ名（selfPartySlug）と 6 体構成（selfTeam）を Parquet に
 * 埋め込むようになった（docs/adr/ADR-0012.md）。get_match / list_matches がそれらを
 * 返し、get_party_from_matches がパーティ単位の照会を担う。
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
  selfTeam: string[];
  selfPartySlug: string | null;
}

/** パーティごとの集計行（get_party_from_matches の一覧用） */
interface PartyAggRow {
  selfPartySlug: string;
  total: number | string;
  win: number | string;
  lose: number | string;
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

/**
 * URL の再生位置を秒で取り出す。
 *
 * 動画を見ている途中で共有リンクをコピーすると `t=` が付く。これは「どの対戦か」を
 * 指す最も確かな手がかりなので、捨てずに拾う。`1311` `1311s` `21m51s` のいずれの
 * 書き方でも来るため、まとめて解釈する。
 */
export function extractTimestampSec(input: string): number | undefined {
  const matched = input.match(/[?&](?:t|start)=([^&\s]+)/);
  if (matched === null) return undefined;

  const raw = matched[1];
  if (/^\d+s?$/.test(raw)) return Number(raw.replace(/s$/, ""));

  const hms = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (hms === null) return undefined;
  const [, hours, minutes, seconds] = hms;
  if (hours === undefined && minutes === undefined && seconds === undefined) {
    return undefined;
  }
  return Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0);
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

async function query<T = MatchRow>(sql: string, values: string[]): Promise<T[]> {
  const connection = await getConnection();
  const reader = await connection.runAndReadAll(sql, values);
  return reader.getRowObjectsJson() as unknown as T[];
}

/** Parquet の場所。利用者の入力は含まれないため、そのまま SQL に埋める */
const SOURCE = `read_parquet(${quote(`s3://${BUCKET}/${OBJECT_KEY}`)})`;

/** 動画の該当位置を指す URL */
function watchUrl(videoId: string, startSec: number): string {
  return `https://youtu.be/${videoId}?t=${startSec}`;
}

/**
 * その再生位置に進行中だった対戦を探す。
 * 最終戦は `endSec` を持たないため、開始位置以降であれば該当とみなす。
 */
function findMatchAt(rows: MatchRow[], timestampSec: number): MatchRow | undefined {
  return rows.find(
    (row) =>
      row.startSec <= timestampSec && (row.endSec === null || timestampSec < row.endSec),
  );
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
    `SELECT matchId, title, result, startSec, endSec, opponentLead, videoTitle, publishedAt, selfPartySlug
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

  // 動画を見ながら貼られたリンクは、再生位置がそのまま「どの対戦か」を指す
  const timestampSec = extractTimestampSec(video);
  const matchAtTimestamp =
    timestampSec === undefined ? undefined : findMatchAt(rows, timestampSec);

  const notes = ["振り返りたい対戦を選び、matchId を指定して get_match を呼ぶ"];
  if (matchAtTimestamp !== undefined) {
    notes.push(
      `URL の再生位置（${timestampSec} 秒）は matchAtTimestamp の対戦を指している。` +
        "利用者が言葉で別の対戦を指定していて食い違う場合は、どちらを振り返るか確認すること",
    );
  } else if (timestampSec !== undefined) {
    notes.push(`URL の再生位置（${timestampSec} 秒）に対応する対戦はない`);
  }

  return {
    videoId,
    videoTitle: rows[0].videoTitle,
    publishedAt: rows[0].publishedAt,
    matchAtTimestamp: matchAtTimestamp?.matchId,
    matches: rows.map((row) => ({
      matchId: row.matchId,
      title: row.title,
      result: row.result,
      opponentLead: row.opponentLead,
      party: row.selfPartySlug ?? undefined,
      url: watchUrl(videoId, row.startSec),
    })),
    notes,
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
    "team はこの対戦で使ったパーティ 6 体、party はそのパーティ名。分析ツール（analyze_selection など）で振り返る前に、まず load_party に party を渡して持ち物・技・性格・SP を取得すること。名前だけを渡すと SP=0・持ち物なしとして計算され、実戦と違う結論になる。分析には team（6 体）を使い、selfSelection（選出 4 体）をパーティ全体と混同しないこと",
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
    party: row.selfPartySlug ?? undefined,
    team: presentOrUndefined(row.selfTeam),
    notes,
  };
}

/**
 * 記録に登場するパーティの一覧（get_party_from_matches の name 省略時）。
 *
 * パーティ名は名前空間を持たない。この記録は自分のものであり、
 * 名前は表示名のまま AI と利用者に見せる（ADR-0009 の付け替え対象ではない）。
 */
async function listParties(): Promise<unknown> {
  const rows = await query<PartyAggRow>(
    `SELECT selfPartySlug,
            count(*) AS total,
            count(*) FILTER (WHERE result = 'win') AS win,
            count(*) FILTER (WHERE result = 'lose') AS lose
     FROM ${SOURCE}
     WHERE selfPartySlug IS NOT NULL
     GROUP BY selfPartySlug
     ORDER BY total DESC
     LIMIT 50`,
    [],
  );

  if (rows.length === 0) {
    return { success: false, error: "対戦記録にパーティ情報はまだ記録されていません" };
  }

  return {
    success: true,
    parties: rows.map((row) => {
      const total = Number(row.total);
      const win = Number(row.win);
      const lose = Number(row.lose);
      return {
        name: row.selfPartySlug,
        record: { total, win, lose, unknown: total - win - lose },
      };
    }),
    notes: ["name を指定して get_party_from_matches を呼ぶと、6 体構成と直近の対戦が分かる"],
  };
}

/**
 * パーティの情報を対戦記録から取得する。
 *
 * name 省略時は記録に登場するパーティの一覧を返す。指定時はそのパーティの
 * 6 体構成と、使われた直近 10 戦を返す。
 *
 * 直近 10 戦の上限は実測に基づく（56 戦全部を返すと 6,553 文字で素通しの上限を
 * 超える。docs/adr/ADR-0012.md）。上限を変えるときは測り直すこと（ADR-0006）。
 */
export async function getPartyFromMatches(name?: string): Promise<unknown> {
  if (name === undefined || name.trim() === "") {
    return listParties();
  }
  const trimmed = name.trim();

  const rows = await query(
    `SELECT matchId, videoId, title, result, startSec, endSec, opponentLead, selfTeam, selfPartySlug, publishedAt
     FROM ${SOURCE}
     WHERE selfPartySlug = $1
     ORDER BY publishedAt DESC, startSec DESC`,
    [trimmed],
  );
  if (rows.length === 0) {
    return {
      success: false,
      error: `このパーティ名の対戦記録は見つかりませんでした（party: ${trimmed}）。パーティ名は list_matches / get_match の party フィールドで確認できます。`,
    };
  }

  const total = rows.length;
  const win = rows.filter((r) => r.result === "win").length;
  const lose = rows.filter((r) => r.result === "lose").length;

  return {
    success: true,
    name: rows[0].selfPartySlug,
    team: presentOrUndefined(rows[0].selfTeam),
    record: { total, win, lose, unknown: total - win - lose },
    matches: rows.slice(0, 10).map((row) => ({
      matchId: row.matchId,
      title: row.title,
      result: row.result,
      opponentLead: row.opponentLead,
      url: watchUrl(row.videoId, row.startSec),
    })),
    notes: [
      `全 ${total} 戦中、直近 10 戦を表示`,
      "この記録に技・ダメージ・ターン推移は含まれない。選出フェーズまでを扱うこと",
    ],
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
  return (
    toolName === "list_matches" ||
    toolName === "get_match" ||
    toolName === "get_party_from_matches"
  );
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

    if (toolName === "get_party_from_matches") {
      const name = args.name;
      if (name !== undefined && typeof name !== "string") {
        return JSON.stringify({ success: false, error: "name は文字列で指定してください" });
      }
      return JSON.stringify(await getPartyFromMatches(name));
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

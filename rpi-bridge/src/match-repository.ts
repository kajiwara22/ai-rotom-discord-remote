/**
 * 対戦記録の読み出し。
 *
 * `pokemon-champions-chapter` が解析結果を Parquet として R2 に置いており、
 * それを DuckDB の httpfs 拡張で直接クエリする。ローカルへ同期しないため、
 * 解析側が差し替えた瞬間から新しいデータで答えられる。
 * 詳しい経緯は docs/adr/ADR-0010.md を参照。
 *
 * 選出・構築に加えて、シーズン・レギュレーション・ランクの文脈列も持つ
 * （docs/adr/ADR-0030.md）。シーズンは `seasonSource` が inferred のことがあり、
 * その場合は動画タイトルの録画日からの推定なので断定させない。
 *
 * 行動ログは `turns.parquet` に別オブジェクトとして入り、get_match_turns が読む
 * （docs/adr/ADR-0022.md）。解析側の v2 スキーマ（ADR-0039）で `side` が付き、
 * 相手の行動も記録される動画がある。ただし対応済みの動画は限られるため、
 * 「opponent の行が無い＝相手が何もしなかった」ではない。
 * HP の観測は `boards.parquet` に分かれていて（ADR-0039 決定9）、自分は実数・
 * 相手は % という非対称な型で持つ。観測が無いターンは欠測であって全快ではない。
 *
 * 解析側が自分のパーティ名（selfPartySlug）と 6 体構成（selfTeam）を Parquet に
 * 埋め込むようになった（docs/adr/ADR-0012.md）。get_match / list_matches がそれらを
 * 返し、get_party_from_matches がパーティ単位の照会を担う。
 */
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";

const BUCKET = process.env.R2_BUCKET_NAME ?? "pcc-data";
const OBJECT_KEY = process.env.PCC_PARQUET_KEY ?? "index/matches.parquet";
const TURNS_KEY = process.env.PCC_TURNS_KEY ?? "index/turns.parquet";
const BOARDS_KEY = process.env.PCC_BOARDS_KEY ?? "index/boards.parquet";

/** 技名の特定が不確かとみなす確信度のしきい値（docs/adr/ADR-0022.md） */
const UNCERTAIN_CONFIDENCE = 0.8;

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
  season: string | null;
  seasonSource: string | null;
  regulation: string | null;
  rankTierStart: string | null;
  rankNumberStart: number | null;
  rankTierEnd: string | null;
  rankNumberEnd: number | null;
}

/** パーティごとの集計行（get_party_from_matches の一覧用） */
interface PartyAggRow {
  selfPartySlug: string;
  total: number | string;
  win: number | string;
  lose: number | string;
}

/**
 * turns.parquet の 1 行（v2 スキーマ。docs/adr/ADR-0039.md）。
 * `side` は self / opponent。相手の行動は解析側が対応した動画にのみ入る。
 * `slot` はダブルの場の位置であって個体ではない（交代で中身が変わる）。
 * matches.parquet の列（title / result / selfPartySlug / startSec）は JOIN で補う。
 */
interface TurnRow {
  videoId: string;
  turn: number;
  sec: number;
  action: string;
  species: string;
  move: string | null;
  direction: string | null;
  confidence: number;
  side: string | null;
  slot: number | null;
  source: string | null;
  title: string;
  result: string;
  selfPartySlug: string | null;
  startSec: number;
}

/**
 * boards.parquet の 1 行（ターン開始時点の盤面スナップショット）。
 * 自分は実数（hpCurrent/hpMax）、相手は %（hpPercent）。使わない列は null。
 * 読めなかったスロットは行そのものが無い＝欠測（docs/adr/ADR-0039.md 決定2）。
 */
interface BoardRow {
  turn: number;
  side: string;
  slot: number;
  species: string;
  hpKind: string | null;
  hpCurrent: number | null;
  hpMax: number | null;
  hpPercent: number | null;
  isMega: boolean | null;
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

  console.log(
    `[match] DuckDB 接続を初期化しました (s3://${BUCKET}/${OBJECT_KEY}, s3://${BUCKET}/${TURNS_KEY})`,
  );
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
const TURNS_SOURCE = `read_parquet(${quote(`s3://${BUCKET}/${TURNS_KEY}`)})`;
const BOARDS_SOURCE = `read_parquet(${quote(`s3://${BUCKET}/${BOARDS_KEY}`)})`;

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
 * battleFormat に応じた選出・先発の体数（ADR-0018）。
 * シングルは選出 3 体・先発 1 体、ダブルは選出 4 体・先発 2 体。
 * 未知の値はダブル扱いで fallback する（現状の記録はダブル中心のため）。
 */
function selectionAndLeadSize(battleFormat: string): { selection: number; lead: number } {
  return battleFormat === "single" || battleFormat === "singles"
    ? { selection: 3, lead: 1 }
    : { selection: 4, lead: 2 };
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
    `SELECT matchId, title, result, startSec, endSec, opponentLead, videoTitle, publishedAt, selfPartySlug, season
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
      season: row.season ?? undefined,
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
  const { selection: selectionCount, lead: leadCount } = selectionAndLeadSize(row.battleFormat);
  const notes = [
    "この記録は選出と構築まで。行動（技・交代・メガ）とターン開始時点の HP は get_match_turns に matchId を渡すと取得できる（記録がある対戦のみ）",
    `team はこの対戦で使ったパーティ 6 体、party はそのパーティ名。分析ツール（analyze_selection など）で振り返る前に、まず load_party に party を渡して持ち物・技・性格・SP を取得すること。名前だけを渡すと SP=0・持ち物なしとして計算され、実戦と違う結論になる。分析には team（6 体）を使い、selfSelection（選出 ${selectionCount} 体）をパーティ全体と混同しないこと`,
  ];
  if (row.seasonSource === "inferred") {
    notes.push(
      "context.season は seasonSource=inferred（動画タイトルの録画日からの推定）。確定事実として書かず「推定」と添えること",
    );
  }
  const opponentSelection = presentOrUndefined(row.opponentSelection);
  if (opponentSelection === undefined) {
    notes.push(`相手の選出 ${selectionCount} 体は未記録。相手について分かるのは構築 6 体と先発 ${leadCount} 体のみ`);
  } else if (opponentSelection.length < selectionCount) {
    // 相手の選出は見えた範囲だけ記録される。相手が有利に展開すると、
    // ダブルでも 4 体そろわず 2〜3 体で止まることがある（ADR-0024）。
    notes.push(
      `相手の選出は見えた範囲のみ（${opponentSelection.length} 体／本来 ${selectionCount} 体）。相手が有利に展開すると、残りの選出は最後まで分からないことがある。記録に無い選出を推定で補って断定しないこと`,
    );
  }

  return {
    matchId: row.matchId,
    title: row.title,
    videoTitle: row.videoTitle,
    publishedAt: row.publishedAt,
    battleFormat: row.battleFormat,
    result: row.result,
    url: watchUrl(row.videoId, row.startSec),
    context: buildContext(row),
    opponentTeam: row.opponentTeam,
    opponentLead: row.opponentLead,
    opponentSelection,
    selfLead: row.selfLead,
    selfSelection: row.selfSelection,
    party: row.selfPartySlug ?? undefined,
    team: presentOrUndefined(row.selfTeam),
    notes,
  };
}

/**
 * 対戦の文脈（シーズン・レギュレーション・ランク）。記録が無ければキーごと省く。
 *
 * `seasonSource` は `ocr`（画面から読めた）/ `inferred`（動画タイトルの録画日からの推定）/
 * `manual`（人手）のいずれか。推定を確定事実として書かせないため、値と一緒に返す。
 */
function buildContext(row: MatchRow): Record<string, unknown> | undefined {
  const context: Record<string, unknown> = {};
  if (row.season !== null) context.season = row.season;
  if (row.seasonSource !== null) context.seasonSource = row.seasonSource;
  if (row.regulation !== null) context.regulation = row.regulation;

  const rankStart = rankEntry(row.rankTierStart, row.rankNumberStart);
  const rankEnd = rankEntry(row.rankTierEnd, row.rankNumberEnd);
  if (rankStart !== undefined) context.rankStart = rankStart;
  if (rankEnd !== undefined) context.rankEnd = rankEnd;

  return Object.keys(context).length > 0 ? context : undefined;
}

function rankEntry(
  tier: string | null,
  num: number | null,
): Record<string, unknown> | undefined {
  if (tier === null && num === null) return undefined;
  const entry: Record<string, unknown> = {};
  if (tier !== null) entry.tier = tier;
  if (num !== null) entry.number = num;
  return entry;
}

/**
 * 1 つの対戦の自分の行動ログ。
 *
 * `turns.parquet` は自分の行動だけを持ち、ターンの抜けも広い。扱う情報と扱わない
 * 情報の境界は docs/adr/ADR-0022.md で定めている。応答の先頭に coverage を置き、
 * 空のターンが「何もしなかった」を意味しないことを AI に伝える。
 *
 * 記録が無いのは異常ではない（行動ログは新規に解析した動画にのみ付く）ため、
 * 対戦そのものが存在する場合は success: true と空の turns を返す。
 */
export async function getMatchTurns(matchId: string): Promise<unknown> {
  const trimmed = matchId.trim();
  if (!MATCH_ID_PATTERN.test(trimmed)) {
    return {
      success: false,
      error: `matchId の形式が不正です: ${matchId}（list_matches が返した matchId をそのまま渡してください）`,
    };
  }

  const rows = await query<TurnRow>(
    `SELECT t.videoId, t.turn, t.sec, t.action, t.species, t.move, t.direction, t.confidence,
            t.side, t.slot, t.source,
            m.title, m.result, m.selfPartySlug, m.startSec
     FROM ${TURNS_SOURCE} t
     JOIN ${SOURCE} m ON m.matchId = t.matchId
     WHERE t.matchId = $1
     ORDER BY t.turn, t.sec`,
    [trimmed],
  );

  // boards は別テーブル（ADR-0039 決定9）。未生成の環境でも turns は返せるようにする
  const boards = await queryBoards(trimmed);

  if (rows.length === 0) {
    const exists = await query<{ matchId: string }>(
      `SELECT matchId FROM ${SOURCE} WHERE matchId = $1`,
      [trimmed],
    );
    if (exists.length === 0) {
      return {
        success: false,
        error: `対戦記録が見つかりませんでした（matchId: ${trimmed}）`,
      };
    }
    // boards は行動ログと同じ再走で生成されるため、行動 0 件なら盤面も無い前提で扱う
    return {
      success: true,
      matchId: trimmed,
      turns: {},
      coverage: { turnsMax: 0, turnsRecorded: 0, missingTurns: [], rows: 0, boards: 0 },
      notes: [
        "この対戦には行動ログが無い。行動ログの抽出は新しく解析した動画にのみ付くため、古い対戦では空になる",
        "選出と構築相性を中心に振り返ること",
      ],
    };
  }

  // 1 ターン = 行動（actions）とターン開始時点の盤面（boards）。
  // HP は行動と同じ粒度で取れないので層を分けてある（ADR-0039 決定2）
  const turns: Record<
    string,
    { actions: Record<string, unknown>[]; boards?: Record<string, unknown>[] }
  > = {};
  let hasUncertain = false;
  for (const row of rows) {
    const action: Record<string, unknown> = {
      sec: row.sec,
      side: row.side ?? "self",
      action: row.action,
      species: row.species,
      confidence: row.confidence,
      url: watchUrl(row.videoId, row.sec),
    };
    if (row.slot !== null) action.slot = row.slot;
    if (row.source !== null) action.source = row.source;
    if (row.move !== null) action.move = row.move;
    if (row.direction !== null) action.direction = row.direction;
    if (row.confidence < UNCERTAIN_CONFIDENCE) {
      action.uncertain = true;
      hasUncertain = true;
    }
    const key = String(row.turn);
    (turns[key] ??= { actions: [] }).actions.push(action);
  }

  for (const board of boards) {
    const key = String(board.turn);
    const entry = (turns[key] ??= { actions: [] });
    (entry.boards ??= []).push(boardEntry(board));
  }

  const present = new Set(rows.map((row) => row.turn));
  const boardTurns = new Set(boards.map((board) => board.turn));
  const turnsMax = Math.max(...present, ...boardTurns);
  const missingTurns: number[] = [];
  for (let turn = 1; turn <= turnsMax; turn++) {
    if (!present.has(turn)) missingTurns.push(turn);
  }

  const bySide = { self: 0, opponent: 0 };
  for (const row of rows) {
    if (row.side === "opponent") bySide.opponent += 1;
    else bySide.self += 1;
  }

  const first = rows[0];
  const notes = [
    "各ターンは actions（行動）と boards（ターン開始時点の盤面）に分かれる。actions の side は self=自分／opponent=相手",
    "side=opponent の行動は、解析側が相手行動の抽出に対応した動画にだけ入る。opponent の行が無い動画では未記録であって「相手が何もしなかった」意味ではない",
    `記録は点列で、抜けているターンがある（missingTurns: ${missingTurns.join(", ") || "なし"}）。抜けは「何もしなかった」を意味しない`,
    "boards は HP の観測。自分は実数（current/max）、相手は %（value）。boards が無いターン・スロットは観測できなかっただけで、全快や瀕死を意味しない。盤面の記録自体が無い対戦もある",
    "slot はダブルの場の位置であって個体ではない。交代で中身が変わるので species とセットで読む",
    "action = switch は交代だけでなく、瀕死後の繰り出しも含む。direction = in を「交代で場に出た」と断定しないこと",
    "各行動の url はその行動の瞬間（動画内の秒）を指す",
  ];
  if (hasUncertain) {
    notes.push("uncertain: true の行は技名の特定が不確か。事実として断定しないこと");
  }

  return {
    matchId: trimmed,
    title: first.title,
    result: first.result,
    party: first.selfPartySlug ?? undefined,
    url: watchUrl(first.videoId, first.startSec),
    coverage: {
      turnsMax,
      turnsRecorded: present.size,
      missingTurns,
      rows: rows.length,
      boards: boards.length,
      bySide,
    },
    turns,
    notes,
  };
}

/** boards.parquet を読む。未生成の環境では空を返す（turns だけは返せるようにする） */
async function queryBoards(matchId: string): Promise<BoardRow[]> {
  try {
    return await query<BoardRow>(
      `SELECT turn, side, slot, species, hpKind, hpCurrent, hpMax, hpPercent, isMega
       FROM ${BOARDS_SOURCE}
       WHERE matchId = $1
       ORDER BY turn, side, slot`,
      [matchId],
    );
  } catch (error) {
    console.log(`[match] boards.parquet を読めませんでした: ${String(error)}`);
    return [];
  }
}

/** boards の 1 行を応答の形にする。HP の有無は kind で判別する */
function boardEntry(row: BoardRow): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    side: row.side,
    slot: row.slot,
    species: row.species,
  };
  if (row.hpKind === "actual" && row.hpCurrent !== null) {
    entry.hp = { kind: "actual", current: row.hpCurrent, max: row.hpMax };
  } else if (row.hpKind === "percent" && row.hpPercent !== null) {
    entry.hp = { kind: "percent", value: row.hpPercent };
  }
  if (row.isMega === true) entry.mega = true;
  return entry;
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
      "この一覧に相手の行動・HP は無い。行動（技・交代・メガ）とターン開始時点の HP は get_match_turns に matchId を渡すと取得できる（記録がある対戦のみ）",
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
    toolName === "get_match_turns" ||
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

    if (toolName === "get_match_turns") {
      const matchId = args.matchId;
      if (typeof matchId !== "string" || matchId.trim() === "") {
        return JSON.stringify({ success: false, error: "matchId を指定してください" });
      }
      return JSON.stringify(await getMatchTurns(matchId));
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

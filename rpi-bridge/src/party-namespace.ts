/**
 * パーティ保存のユーザー分離。
 *
 * 上流の ai-rotom はパーティを `~/.ai-rotom/parties.json` の単一ファイルへ
 * 保存し、保存先を変える手段を持たない（パスは os.homedir() 固定）。
 * そのままでは家族全員が 1 つの名前空間を共有し、同名のパーティが黙って
 * 上書きされる。
 *
 * そこで Pi 側でパーティ名に利用者の名前空間を前置し、結果を返すときに外す。
 * 利用者と AI から見える名前は元のままで、ファイルの中だけが分離される。
 * 詳しい経緯は docs/adr/ADR-0009.md を参照。
 */

const SEPARATOR = "/";

/** Discord はチャンネル単位で会話を共有する場なので、参加者で 1 つの棚を使う */
export const DISCORD_NAMESPACE = "discord";

export function webNamespace(userId: string): string {
  return `user:${userId}`;
}

/** name を引数に取るパーティ系ツール */
const NAME_ARG_TOOLS = new Set([
  "save_party",
  "load_party",
  "delete_party",
  "import_party_from_text",
]);

/** 結果に含まれるパーティ名から接頭辞を外す必要があるツール */
const RESULT_TOOLS = new Set([
  "save_party",
  "load_party",
  "delete_party",
  "import_party_from_text",
  "list_parties",
]);

function prefixOf(namespace: string): string {
  return namespace + SEPARATOR;
}

/**
 * ツール引数のパーティ名に名前空間を前置する。
 * パーティ系以外のツールは何もしない。
 */
export function applyPartyNamespace(
  toolName: string,
  args: Record<string, unknown>,
  namespace: string,
): Record<string, unknown> {
  if (!NAME_ARG_TOOLS.has(toolName)) return args;
  if (typeof args.name !== "string") return args;

  return { ...args, name: prefixOf(namespace) + args.name };
}

/** 接頭辞付きの名前を元に戻す。自分のものでなければ null */
function stripName(value: unknown, prefix: string): string | null {
  if (typeof value !== "string") return null;
  return value.startsWith(prefix) ? value.slice(prefix.length) : null;
}

/**
 * ツール結果から名前空間の痕跡を取り除く。
 *
 * - `list_parties` は自分の名前空間のものだけに絞る
 * - その他は結果に含まれるパーティ名から接頭辞を外す
 * - `filePath`（保存先の絶対パス）は内部情報なので落とす
 */
export function stripPartyNamespace(
  toolName: string,
  raw: string,
  namespace: string,
): string {
  if (!RESULT_TOOLS.has(toolName)) return raw;

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (data === null || typeof data !== "object") return raw;

  const obj = data as Record<string, unknown>;
  if ("error" in obj) return raw;

  const prefix = prefixOf(namespace);

  if (toolName === "list_parties") {
    const parties = Array.isArray(obj.parties) ? obj.parties : [];
    const mine: unknown[] = [];
    for (const p of parties) {
      if (p === null || typeof p !== "object") continue;
      const row = p as Record<string, unknown>;
      const name = stripName(row.name, prefix);
      if (name !== null) mine.push({ ...row, name });
    }
    return JSON.stringify({ ...obj, parties: mine });
  }

  const result: Record<string, unknown> = { ...obj };
  delete result.filePath;

  // トップレベルの name（delete_party など）
  const topName = stripName(result.name, prefix);
  if (topName !== null) result.name = topName;

  // party オブジェクトの中の name（save_party / load_party など）
  if (result.party !== null && typeof result.party === "object") {
    const party = result.party as Record<string, unknown>;
    const partyName = stripName(party.name, prefix);
    if (partyName !== null) result.party = { ...party, name: partyName };
  }

  return JSON.stringify(result);
}

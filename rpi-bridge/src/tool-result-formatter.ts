/**
 * MCP ツールの生出力を、LLM に渡す形へ整形する層。
 *
 * ai-rotom の分析系ツールは出力が桁違いに大きい（実測で最大 5.7MB）。
 * 先頭からの一律切り詰めは JSON を構造の途中で壊すうえ、結果が並べ替え
 * られていないため判断材料が残らない。ここでツールごとに「判断に効く順」
 * へ並べ替えてから上位を残す。詳しい経緯は docs/adr/ADR-0006.md を参照。
 *
 * 整形の原則:
 * - 捨てる順序は設計者が決める（先頭から機械的に切らない）
 * - 削ったときは必ず全体件数を添える（LLM が全量と誤認するのを防ぐ）
 * - 日本語フィールド（nameJa / moveJa）があれば優先して使う
 */

/** 整形関数を持たないツールを素通しできる上限 */
const PASSTHROUGH_LIMIT = 5000;
/** 整形関数がなく上限も超えた場合の最終防壁 */
const HARD_LIMIT = 6000;
/** 育成論の考察本文を LLM に渡す上限。本文は DB には全文残る（ADR-0013） */
const THEORY_BODY_LIMIT = 4800;

/** ダメージ計算結果 1 件（outgoing / incoming / results の要素） */
interface DamageEntry {
  maxPercent?: number;
  description?: string;
}

type Json = Record<string, unknown>;

function asArray(value: unknown): Json[] {
  return Array.isArray(value) ? (value as Json[]) : [];
}

function num(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

/** ダメージ計算結果を与ダメージ率の降順に並べ、上位 n 件の説明文を返す */
function topDamageDescriptions(entries: unknown, n: number): string[] {
  return asArray(entries)
    .map((e) => e as DamageEntry)
    .filter((e) => num(e.maxPercent) > 0)
    .sort((a, b) => num(b.maxPercent) - num(a.maxPercent))
    .slice(0, n)
    .map((e) => e.description ?? "")
    .filter(Boolean);
}

/** ダメージ計算結果のうち最大のものを返す */
function maxDamage(entries: unknown): DamageEntry | undefined {
  return asArray(entries)
    .map((e) => e as DamageEntry)
    .reduce<DamageEntry | undefined>(
      (best, e) => (best === undefined || num(e.maxPercent) > num(best.maxPercent) ? e : best),
      undefined,
    );
}

/** ポケモン一覧を名前・タイプ・種族値合計だけに落とす（詳細は個別ツールで引ける） */
function compactPokemonList(list: unknown, limit: number): Json[] {
  return asArray(list)
    .slice(0, limit)
    .map((p) => {
      const stats = (p.baseStats ?? {}) as Record<string, number>;
      const bst = p.bst ?? Object.values(stats).reduce((sum, v) => sum + num(v), 0);
      const row: Json = { name: p.nameJa ?? p.name, types: p.types, bst };
      if (p.matchedEffectiveness !== undefined) row.matched = p.matchedEffectiveness;
      return row;
    });
}

type Formatter = (data: Json) => unknown;

/**
 * 育成論ツールの考察本文を上限で区切る。本文は prose なので JSON 構造は壊れない。
 * 構造化ヘッダ（性格・特性・持ち物・SP・技）はそのまま残す。
 * 全文は DB の theory_refs.body_text に保持されている（ADR-0013）。
 */
function boundTheoryBody(data: Json): Json {
  const theory = (data.theory ?? {}) as Json;
  const body = typeof theory.body === "string" ? theory.body : "";
  if (body.length <= THEORY_BODY_LIMIT) return data;
  return {
    ...data,
    theory: {
      ...theory,
      body: body.slice(0, THEORY_BODY_LIMIT),
      body_note: `考察本文は全 ${body.length} 字。先頭 ${THEORY_BODY_LIMIT} 字のみ表示（後半は省略）`,
    },
  };
}

const FORMATTERS: Record<string, Formatter> = {
  // 特性は名前（abilities / abilitiesJa）だけが返り、効果は入っていない。
  // 効果を書かせるとモデルが記憶（従来作）で補うため、get_ability_info での裏取りを促す
  get_pokemon_info: (d) => ({
    ...d,
    note: "特性の効果を回答に書く場合は、必ず get_ability_info を呼んで確認してから書くこと",
  }),

  // get_pokemon_info と同じ理由。basic に特性名が含まれる
  get_pokemon_summary: (d) => ({
    ...d,
    note: "特性の効果を回答に書く場合は、必ず get_ability_info を呼んで確認してから書くこと",
  }),

  // 実測 113,370 字。results が 280 件にもなるのは、このツールが learnset を
  // 参照せず全技を計算しているため（同じポケモンでも analyze_matchup は 42 件）。
  // 覚えない技が上位を占めうるので、その旨を必ず添える
  calculate_damage_all_moves: (d) => {
    const all = asArray(d.results);
    const top = topDamageDescriptions(all, 10);
    return {
      attacker: d.attacker,
      defender: d.defender,
      note:
        `全 ${all.length} 技中、与ダメージ上位 ${top.length} 件。` +
        `この一覧は該当ポケモンが覚えない技も含むため、採用する前に get_learnset で実際に覚えるかを確認すること`,
      top,
    };
  },

  // 実測 28,932 字。双方の全攻撃技のダメージが入っている
  analyze_matchup: (d) => {
    const a1 = asArray(d.pokemon1Attacks);
    const a2 = asArray(d.pokemon2Attacks);
    return {
      pokemon1: d.pokemon1,
      pokemon2: d.pokemon2,
      pokemon1Faster: d.pokemon1Faster,
      note: `攻撃技は 全 ${a1.length} / ${a2.length} 件中の上位 5 件`,
      pokemon1TopAttacks: topDamageDescriptions(a1, 5),
      pokemon2TopAttacks: topDamageDescriptions(a2, 5),
      pokemon1PriorityMoves: d.pokemon1PriorityMoves,
      pokemon2PriorityMoves: d.pokemon2PriorityMoves,
      typeSummary: d.typeSummary,
    };
  },

  // 実測 5,692,717 字（候補プール無指定）。1 候補ごとに全技のダメージが入る
  find_counters: (d) => {
    const counters = asArray(d.counters)
      .map((c) => {
        const best = maxDamage(c.outgoing);
        const worst = maxDamage(c.incoming);
        const pokemon = (c.pokemon ?? {}) as Json;
        return {
          score: num(best?.maxPercent),
          row: {
            pokemon: pokemon.nameJa ?? pokemon.name,
            types: pokemon.types,
            abilities: pokemon.abilities,
            speed: c.speedCompare,
            bestAttack: best?.description,
            worstIncoming: worst?.description,
          },
        };
      })
      .sort((a, b) => b.score - a.score);

    return {
      target: d.target,
      note: `候補 ${counters.length} 体中、与ダメージ上位 ${Math.min(8, counters.length)} 体`,
      counters: counters.slice(0, 8).map((c) => c.row),
    };
  },

  // 実測 52,420 字。複合タイプ 102 通り × 候補技が大半を占める
  analyze_party_coverage: (d) => {
    const dual = asArray(d.dualTypeCoverage);
    const uncovered = dual
      .filter((x) => num(x.maxMultiplier) < 2)
      .slice(0, 20)
      .map((x) => ({
        types: x.defenderTypesJa ?? x.defenderTypes,
        maxMultiplier: x.maxMultiplier,
        example: x.examplePokemon,
      }));

    return {
      uncoveredTypes: d.uncoveredTypes,
      dualTypeUncoveredCount: d.dualTypeUncoveredCount,
      note: `複合タイプ ${dual.length} 通りのうち、抜群を取れないもののみ表示`,
      uncoveredDualTypes: uncovered,
      coverage: asArray(d.coverage).map((x) => ({
        type: x.defenderTypeJa ?? x.defenderType,
        maxMultiplier: x.maxMultiplier,
        best: asArray(x.bestAttackers)[0],
      })),
    };
  },

  // 実測 38,101 字（全 323 件）。around / range で絞れば 4,000 字程度に収まる
  list_speed_tiers: (d) => {
    const entries = asArray(d.entries);
    if (entries.length <= 45) return d;
    return {
      note: `全 ${entries.length} 件中の速い順 45 件。around でポケモンを指定するか range で範囲を絞ると、その周辺を全件確認できる`,
      entries: entries.slice(0, 45),
    };
  },

  // 実測 17,446 字。6v6 の 36 マスは選出判断に必要なので件数は削らず、
  // 各マスを 1 行の文字列にしてキー名の繰り返しを省く
  analyze_selection: (d) => {
    const myParty = asArray(d.myParty);
    const opponentParty = asArray(d.opponentParty);

    // マトリクスは英語名で参照してくるため、日本語名の対応表を作る
    const nameJa = new Map<string, string>();
    for (const m of [...myParty, ...opponentParty]) {
      if (typeof m.name === "string") nameJa.set(m.name, (m.nameJa as string) ?? m.name);
    }
    const ja = (name: unknown) =>
      typeof name === "string" ? (nameJa.get(name) ?? name) : String(name);

    const compactMember = (m: Json) => ({
      name: m.nameJa ?? m.name,
      types: m.types,
      stats: m.actualStats,
    });

    return {
      battleFormat: d.battleFormat,
      myParty: myParty.map(compactMember),
      opponentParty: opponentParty.map(compactMember),
      matchupNote: "自分 → 相手: タイプ倍率(与/被) 素早さ 最大打点 与ダメージ率 KO判定",
      matchupMatrix: asArray(d.matchupMatrix).map((m) => {
        const est = (m.damageEstimate ?? {}) as Json;
        const move = (est.move ?? {}) as Json;
        const adv = (m.typeAdvantage ?? {}) as Json;
        const parts = [
          `${ja(m.mine)} → ${ja(m.opponent)}:`,
          `${adv.myToOpp ?? "?"}x/${adv.oppToMy ?? "?"}x`,
          String(m.speedCompare ?? ""),
          String(move.nameJa ?? move.name ?? ""),
          est.max !== undefined ? `${est.max}%` : "",
          String(est.ohkoChance ?? ""),
        ];
        return parts.filter(Boolean).join(" ");
      }),
    };
  },

  // 実測 6,171 字。1 マスあたりの情報量を落として全 6x6 を残す
  calculate_damage_party_matchup: (d) => ({
    matchups: asArray(d.matchups).map((m) => ({
      attacker: m.attackerNameJa ?? m.attacker,
      vs: asArray(m.results).map(
        (r) =>
          `${r.defenderNameJa ?? r.defender}: ${r.bestMoveJa ?? r.bestMove} ${r.maxDamagePercent}% ${r.koChance ?? ""}`.trim(),
      ),
    })),
  }),

  // 実測 11,449 字（91 体）
  search_pokemon_by_move: (d) => {
    const list = asArray(d.pokemon);
    return {
      move: d.move,
      note: `全 ${list.length} 体中の先頭 40 体`,
      pokemon: compactPokemonList(list, 40),
    };
  },

  // 実測 14,977 字（69 体）
  search_pokemon_by_type_effectiveness: (d) => {
    const list = asArray(d.pokemon);
    return {
      conditions: d.conditions,
      note: `全 ${list.length} 体中の先頭 40 体`,
      pokemon: compactPokemonList(list, 40),
    };
  },

  // 育成論の考察本文は DB には全文残しつつ、LLM に渡す本文だけを上限で区切る。
  // 構造化ヘッダ（性格・特性・持ち物・SP・技）は切らない（ADR-0013）
  import_theory_from_url: boundTheoryBody,
  get_theory: boundTheoryBody,
};

/**
 * ツール結果を LLM に渡す形へ整形する。
 *
 * 整形関数を持つツールはそれを適用し、持たないツールは素通しする。
 * JSON として解釈できない場合と、整形関数がないまま上限を超えた場合だけ、
 * 最後の手段として切り詰める（その旨を明示する）。
 */
export function formatToolResult(toolName: string, raw: string): string {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return truncate(raw, `[${toolName}] JSON として解釈できませんでした`);
  }

  // エラー応答はそのまま返す（短く、内容がそのまま判断材料になる）
  if (data !== null && typeof data === "object" && "error" in data) {
    return raw;
  }

  const formatter = FORMATTERS[toolName];
  if (formatter && data !== null && typeof data === "object") {
    const formatted = JSON.stringify(formatter(data as Json));
    console.log(`[format] ${toolName}: ${raw.length} → ${formatted.length} 文字`);
    return formatted.length <= HARD_LIMIT
      ? formatted
      : truncate(formatted, `[${toolName}] 整形後も上限を超えました`);
  }

  if (raw.length <= PASSTHROUGH_LIMIT) {
    return raw;
  }

  console.warn(`[format] ${toolName}: 整形関数がなく ${raw.length} 文字を切り詰めます`);
  return truncate(raw, `[${toolName}] 整形関数が未定義です`);
}

/**
 * 最終防壁。ここに到達するのは想定外なので、切り詰めた事実を LLM に明示し、
 * 途中で壊れた JSON をそのまま信じないよう伝える。
 */
function truncate(raw: string, reason: string): string {
  if (raw.length <= HARD_LIMIT) return raw;
  return (
    raw.slice(0, HARD_LIMIT) +
    `\n...(全 ${raw.length} 文字中の先頭 ${HARD_LIMIT} 文字のみ。${reason}。` +
    `末尾が欠けているため、この結果は不完全です。条件を絞って呼び直してください)`
  );
}

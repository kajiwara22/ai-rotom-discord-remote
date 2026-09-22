// 自動生成: scripts/generate-pi.ts から生成。手編集しないこと。
// 変更したい場合はスクリプト側を直して再生成する:
//   cd rpi-bridge && node --import tsx ../scripts/generate-pi.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

const BRIDGE_URL = process.env.ROTOM_BRIDGE_URL ?? "http://127.0.0.1:3210";
const USER_ID = process.env.ROTOM_USER_ID ?? "me";

interface ToolEntry {
  name: string;
  label: string;
  description: string;
  promptSnippet: string;
  parameters: any;
}

export default function rotomExtension(pi: ExtensionAPI) {
  const tools: ToolEntry[] = [
    {
      name: "get_pokemon_info",
      label: "get_pokemon_info",
      description: "ポケモンの詳細情報（種族値・タイプ・特性・体重）を取得する。ポケモンチャンピオンズ (Pokemon Champions) 仕様。特性は名前のみ返るため、その効果を回答に書く場合は get_ability_info を呼んで確認すること。",
      promptSnippet: "ポケモンの詳細情報（種族値・タイプ・特性・体重）を取得する。ポケモンチャンピオンズ (Pokemon Champions) 仕様。特性は名前のみ返るため、その効果を回答に書く場合は get_ability_info を呼んで確認すること。",
      parameters: Type.Object({ "name": Type.String({ description: "ポケモン名（日本語 or 英語）" }) }),
    },
    {
      name: "get_pokemon_summary",
      label: "get_pokemon_summary",
      description: "ポケモンの総合プロファイル（基本情報・防御相性・覚える技の集計・実数値）を一度に取得する。特性は名前のみ返るため、その効果を回答に書く場合は get_ability_info を呼んで確認すること。",
      promptSnippet: "ポケモンの総合プロファイル（基本情報・防御相性・覚える技の集計・実数値）を一度に取得する。特性は名前のみ返るため、その効果を回答に書く場合は get_ability_info を呼んで確認すること。",
      parameters: Type.Object({ "name": Type.String({ description: "ポケモン名（日本語 or 英語）" }) }),
    },
    {
      name: "get_move_info",
      label: "get_move_info",
      description: "技の詳細情報（タイプ・威力・命中率・分類・優先度・効果説明）を取得する。ポケモンチャンピオンズ対応。",
      promptSnippet: "技の詳細情報（タイプ・威力・命中率・分類・優先度・効果説明）を取得する。ポケモンチャンピオンズ対応。",
      parameters: Type.Object({ "name": Type.String({ description: "技名（日本語 or 英語）" }) }),
    },
    {
      name: "get_ability_info",
      label: "get_ability_info",
      description: "ポケモンの特性の詳細情報（効果説明）を取得する。",
      promptSnippet: "ポケモンの特性の詳細情報（効果説明）を取得する。",
      parameters: Type.Object({ "name": Type.String({ description: "特性名（日本語 or 英語）" }) }),
    },
    {
      name: "get_item_info",
      label: "get_item_info",
      description: "ポケモンの持ち物（アイテム）の詳細情報（効果説明、メガストーン情報）を取得する。",
      promptSnippet: "ポケモンの持ち物（アイテム）の詳細情報（効果説明、メガストーン情報）を取得する。",
      parameters: Type.Object({ "name": Type.String({ description: "持ち物名（日本語 or 英語）" }) }),
    },
    {
      name: "get_nature_info",
      label: "get_nature_info",
      description: "ポケモンの性格の詳細情報（上昇ステ・下降ステ）を取得する。",
      promptSnippet: "ポケモンの性格の詳細情報（上昇ステ・下降ステ）を取得する。",
      parameters: Type.Object({ "name": Type.String({ description: "性格名（日本語 or 英語、例: 'ひかえめ'、'Modest'）" }) }),
    },
    {
      name: "get_type_info",
      label: "get_type_info",
      description: "ポケモンのタイプの相性情報（攻撃時・防御時の倍率）を取得する。",
      promptSnippet: "ポケモンのタイプの相性情報（攻撃時・防御時の倍率）を取得する。",
      parameters: Type.Object({ "type": Type.String({ description: "タイプ名（日本語 or 英語、例: 'ほのお'、'Fire'）" }) }),
    },
    {
      name: "get_condition_info",
      label: "get_condition_info",
      description: "バトル条件（天候・フィールド・状態異常・サイド効果）の情報を取得する。",
      promptSnippet: "バトル条件（天候・フィールド・状態異常・サイド効果）の情報を取得する。",
      parameters: Type.Object({ "category": Type.Optional(StringEnum(["weather","terrain","status","sideCondition"] as const, { description: "絞り込むカテゴリ" })), "name": Type.Optional(Type.String({ description: "絞り込む条件名（省略時は全件）" })) }),
    },
    {
      name: "get_learnset",
      label: "get_learnset",
      description: "ポケモンチャンピオンズで特定のポケモンが覚える技の一覧を取得する。技名のみ返るため、威力・命中・効果を回答に書く場合は get_move_info を呼んで確認すること。",
      promptSnippet: "ポケモンチャンピオンズで特定のポケモンが覚える技の一覧を取得する。技名のみ返るため、威力・命中・効果を回答に書く場合は get_move_info を呼んで確認すること。",
      parameters: Type.Object({ "name": Type.String({ description: "ポケモン名（日本語 or 英語）" }) }),
    },
    {
      name: "search_pokemon",
      label: "search_pokemon",
      description: "ポケモンチャンピオンズに登場するポケモンをタイプや種族値で検索する。",
      promptSnippet: "ポケモンチャンピオンズに登場するポケモンをタイプや種族値で検索する。",
      parameters: Type.Object({ "type": Type.Optional(Type.String({ description: "タイプで絞り込み（例: 'ほのお'、'Fire'）" })), "minStat": Type.Optional(Type.Object({ "hp": Type.Optional(Type.Number()), "atk": Type.Optional(Type.Number()), "def": Type.Optional(Type.Number()), "spa": Type.Optional(Type.Number()), "spd": Type.Optional(Type.Number()), "spe": Type.Optional(Type.Number()) }, { description: "種族値の下限で絞り込み" })), "limit": Type.Optional(Type.Number({ description: "返す件数（デフォルト: 20）" })) }),
    },
    {
      name: "search_pokemon_by_move",
      label: "search_pokemon_by_move",
      description: "特定の技を覚えるポケモンを逆引き検索する。",
      promptSnippet: "特定の技を覚えるポケモンを逆引き検索する。",
      parameters: Type.Object({ "moveName": Type.String({ description: "技名（日本語 or 英語）" }) }),
    },
    {
      name: "search_pokemon_by_ability",
      label: "search_pokemon_by_ability",
      description: "特定の特性を持つポケモンを逆引き検索する。",
      promptSnippet: "特定の特性を持つポケモンを逆引き検索する。",
      parameters: Type.Object({ "abilityName": Type.String({ description: "特性名（日本語 or 英語）" }) }),
    },
    {
      name: "search_pokemon_by_type_effectiveness",
      label: "search_pokemon_by_type_effectiveness",
      description: "タイプ相性条件でポケモンを逆引き検索する。",
      promptSnippet: "タイプ相性条件でポケモンを逆引き検索する。",
      parameters: Type.Object({ "resistsType": Type.Optional(Type.String({ description: "指定タイプの攻撃を0.5倍以下で受けるポケモン" })), "immuneToType": Type.Optional(Type.String({ description: "指定タイプの攻撃を無効化するポケモン" })), "weakToType": Type.Optional(Type.String({ description: "指定タイプの攻撃で2倍以上のダメージを受けるポケモン" })), "hasAttackingType": Type.Optional(Type.String({ description: "指定タイプの攻撃技を1つ以上覚えるポケモン" })) }),
    },
    {
      name: "calculate_stats",
      label: "calculate_stats",
      description: "ポケモンの実数値計算。種族値・性格・能力ポイント(SP)から各ステータスの実数値を算出する。ポケモンチャンピオンズ仕様（Lv50・IV31固定）。SPは各0-32・合計0-66。",
      promptSnippet: "ポケモンの実数値計算。種族値・性格・能力ポイント(SP)から各ステータスの実数値を算出する。ポケモンチャンピオンズ仕様（Lv50・IV31固定）。SPは各0-32・合計0-66。",
      parameters: Type.Object({ "name": Type.String({ description: "ポケモン名（日本語 or 英語）" }), "nature": Type.Optional(Type.String({ description: "性格名（省略時: まじめ）" })), "evs": Type.Optional(Type.Object({ "hp": Type.Optional(Type.Integer({ minimum: 0, maximum: 32 })), "atk": Type.Optional(Type.Integer({ minimum: 0, maximum: 32 })), "def": Type.Optional(Type.Integer({ minimum: 0, maximum: 32 })), "spa": Type.Optional(Type.Integer({ minimum: 0, maximum: 32 })), "spd": Type.Optional(Type.Integer({ minimum: 0, maximum: 32 })), "spe": Type.Optional(Type.Integer({ minimum: 0, maximum: 32 })) }, { description: "能力ポイント(SP)。各0-32、合計0-66。省略時は全0。" })) }),
    },
    {
      name: "calculate_damage_single",
      label: "calculate_damage_single",
      description: "ポケモンのダメージ計算。攻撃側ポケモンの指定した1技が防御側ポケモンに与えるダメージを計算。ポケモンチャンピオンズ対応。SPは各0-32・合計0-66。",
      promptSnippet: "ポケモンのダメージ計算。攻撃側ポケモンの指定した1技が防御側ポケモンに与えるダメージを計算。ポケモンチャンピオンズ対応。SPは各0-32・合計0-66。",
      parameters: Type.Object({ "attacker": Type.Object({ "name": Type.String({ description: "攻撃側ポケモン名" }), "nature": Type.Optional(Type.String({ description: "性格名" })), "evs": Type.Optional(Type.Object({ "hp": Type.Optional(Type.Integer()), "atk": Type.Optional(Type.Integer()), "def": Type.Optional(Type.Integer()), "spa": Type.Optional(Type.Integer()), "spd": Type.Optional(Type.Integer()), "spe": Type.Optional(Type.Integer()) }, { description: "能力ポイント(SP)" })), "ability": Type.Optional(Type.String({ description: "特性名" })), "item": Type.Optional(Type.String({ description: "持ち物名" })), "boosts": Type.Optional(Type.Object({ "atk": Type.Optional(Type.Integer()), "def": Type.Optional(Type.Integer()), "spa": Type.Optional(Type.Integer()), "spd": Type.Optional(Type.Integer()), "spe": Type.Optional(Type.Integer()) }, { description: "ランク補正(-6〜+6)" })), "status": Type.Optional(Type.String({ description: "状態異常" })) }), "defender": Type.Object({ "name": Type.String(), "nature": Type.Optional(Type.String()), "evs": Type.Optional(Type.Object({ "hp": Type.Optional(Type.Integer()), "atk": Type.Optional(Type.Integer()), "def": Type.Optional(Type.Integer()), "spa": Type.Optional(Type.Integer()), "spd": Type.Optional(Type.Integer()), "spe": Type.Optional(Type.Integer()) })), "ability": Type.Optional(Type.String()), "item": Type.Optional(Type.String()), "boosts": Type.Optional(Type.Object({ "atk": Type.Optional(Type.Integer()), "def": Type.Optional(Type.Integer()), "spa": Type.Optional(Type.Integer()), "spd": Type.Optional(Type.Integer()), "spe": Type.Optional(Type.Integer()) })), "status": Type.Optional(Type.String()) }), "moveName": Type.String({ description: "技名" }), "conditions": Type.Optional(Type.Object({ "weather": Type.Optional(StringEnum(["Sun","Rain","Sand","Hail","Snow"] as const)), "terrain": Type.Optional(StringEnum(["Electric","Grassy","Misty","Psychic"] as const)), "battleFormat": Type.Optional(StringEnum(["singles","doubles"] as const)), "isReflect": Type.Optional(Type.Boolean()), "isLightScreen": Type.Optional(Type.Boolean()), "isAuroraVeil": Type.Optional(Type.Boolean()), "isCriticalHit": Type.Optional(Type.Boolean()) })) }),
    },
    {
      name: "calculate_damage_all_moves",
      label: "calculate_damage_all_moves",
      description: "攻撃側ポケモンの全攻撃技のダメージを一括計算する。どの技が最も有効かを比較するときに使用する。",
      promptSnippet: "攻撃側ポケモンの全攻撃技のダメージを一括計算する。どの技が最も有効かを比較するときに使用する。",
      parameters: Type.Object({ "attacker": Type.Object({ "name": Type.String(), "nature": Type.Optional(Type.String()), "evs": Type.Optional(Type.Object({ "hp": Type.Optional(Type.Integer()), "atk": Type.Optional(Type.Integer()), "def": Type.Optional(Type.Integer()), "spa": Type.Optional(Type.Integer()), "spd": Type.Optional(Type.Integer()), "spe": Type.Optional(Type.Integer()) })), "ability": Type.Optional(Type.String()), "item": Type.Optional(Type.String()), "boosts": Type.Optional(Type.Object({ "atk": Type.Optional(Type.Integer()), "def": Type.Optional(Type.Integer()), "spa": Type.Optional(Type.Integer()), "spd": Type.Optional(Type.Integer()), "spe": Type.Optional(Type.Integer()) })), "status": Type.Optional(Type.String()) }), "defender": Type.Object({ "name": Type.String(), "nature": Type.Optional(Type.String()), "evs": Type.Optional(Type.Object({ "hp": Type.Optional(Type.Integer()), "atk": Type.Optional(Type.Integer()), "def": Type.Optional(Type.Integer()), "spa": Type.Optional(Type.Integer()), "spd": Type.Optional(Type.Integer()), "spe": Type.Optional(Type.Integer()) })), "ability": Type.Optional(Type.String()), "item": Type.Optional(Type.String()), "boosts": Type.Optional(Type.Object({ "atk": Type.Optional(Type.Integer()), "def": Type.Optional(Type.Integer()), "spa": Type.Optional(Type.Integer()), "spd": Type.Optional(Type.Integer()), "spe": Type.Optional(Type.Integer()) })), "status": Type.Optional(Type.String()) }), "conditions": Type.Optional(Type.Object({ "weather": Type.Optional(Type.String()), "terrain": Type.Optional(Type.String()), "battleFormat": Type.Optional(StringEnum(["singles","doubles"] as const)), "isReflect": Type.Optional(Type.Boolean()), "isLightScreen": Type.Optional(Type.Boolean()), "isAuroraVeil": Type.Optional(Type.Boolean()), "isCriticalHit": Type.Optional(Type.Boolean()) })) }),
    },
    {
      name: "calculate_damage_party_matchup",
      label: "calculate_damage_party_matchup",
      description: "パーティ対パーティの全組み合わせダメージ計算。6vs6の全対面での火力関係を一覧する。",
      promptSnippet: "パーティ対パーティの全組み合わせダメージ計算。6vs6の全対面での火力関係を一覧する。",
      parameters: Type.Object({ "myParty": Type.Array(Type.Object({ "name": Type.String(), "nature": Type.Optional(Type.String()), "evs": Type.Optional(Type.Object({})), "ability": Type.Optional(Type.String()), "item": Type.Optional(Type.String()) }), { description: "自分のパーティ" }), "opponentParty": Type.Array(Type.Object({ "name": Type.String(), "nature": Type.Optional(Type.String()), "evs": Type.Optional(Type.Object({})), "ability": Type.Optional(Type.String()), "item": Type.Optional(Type.String()) }), { description: "相手のパーティ" }), "conditions": Type.Optional(Type.Object({ "weather": Type.Optional(Type.String()), "terrain": Type.Optional(Type.String()), "battleFormat": Type.Optional(StringEnum(["singles","doubles"] as const)), "isReflect": Type.Optional(Type.Boolean()), "isLightScreen": Type.Optional(Type.Boolean()), "isAuroraVeil": Type.Optional(Type.Boolean()), "isCriticalHit": Type.Optional(Type.Boolean()) })) }),
    },
    {
      name: "list_speed_tiers",
      label: "list_speed_tiers",
      description: "素早さの実数値ライン一覧を取得する。ポケモンチャンピオンズ仕様（Lv50・IV31）。",
      promptSnippet: "素早さの実数値ライン一覧を取得する。ポケモンチャンピオンズ仕様（Lv50・IV31）。",
      parameters: Type.Object({ "around": Type.Optional(Type.String({ description: "指定ポケモン付近(±10)の素早さラインのみを返す" })), "range": Type.Optional(Type.Object({ "min": Type.Optional(Type.Number()), "max": Type.Optional(Type.Number()) }, { description: "実数値の範囲フィルタ" })) }),
    },
    {
      name: "analyze_damage_range",
      label: "analyze_damage_range",
      description: "ダメージ計算を逆引きして、防御側を耐えさせるために必要な最小 SP 配分を探索する。",
      promptSnippet: "ダメージ計算を逆引きして、防御側を耐えさせるために必要な最小 SP 配分を探索する。",
      parameters: Type.Object({ "attacker": Type.Object({ "name": Type.String(), "nature": Type.Optional(Type.String()), "evs": Type.Optional(Type.Object({})), "ability": Type.Optional(Type.String()), "item": Type.Optional(Type.String()), "boosts": Type.Optional(Type.Object({})), "status": Type.Optional(Type.String()) }), "defender": Type.Object({ "name": Type.String(), "nature": Type.Optional(Type.String()), "evs": Type.Optional(Type.Object({})), "ability": Type.Optional(Type.String()), "item": Type.Optional(Type.String()), "boosts": Type.Optional(Type.Object({})), "status": Type.Optional(Type.String()) }), "moveName": Type.String({ description: "技名" }), "conditions": Type.Optional(Type.Object({ "weather": Type.Optional(Type.String()), "terrain": Type.Optional(Type.String()), "battleFormat": Type.Optional(Type.String()), "isReflect": Type.Optional(Type.Boolean()), "isLightScreen": Type.Optional(Type.Boolean()), "isAuroraVeil": Type.Optional(Type.Boolean()), "isCriticalHit": Type.Optional(Type.Boolean()) })) }),
    },
    {
      name: "analyze_matchup",
      label: "analyze_matchup",
      description: "ポケモン2体の対面を分析する。双方向のダメージ計算と素早さ比較を行う。",
      promptSnippet: "ポケモン2体の対面を分析する。双方向のダメージ計算と素早さ比較を行う。",
      parameters: Type.Object({ "pokemon1": Type.Object({ "name": Type.String(), "nature": Type.Optional(Type.String()), "evs": Type.Optional(Type.Object({})), "ability": Type.Optional(Type.String()), "item": Type.Optional(Type.String()), "boosts": Type.Optional(Type.Object({})), "status": Type.Optional(Type.String()) }), "pokemon2": Type.Object({ "name": Type.String(), "nature": Type.Optional(Type.String()), "evs": Type.Optional(Type.Object({})), "ability": Type.Optional(Type.String()), "item": Type.Optional(Type.String()), "boosts": Type.Optional(Type.Object({})), "status": Type.Optional(Type.String()) }), "conditions": Type.Optional(Type.Object({ "weather": Type.Optional(Type.String()), "terrain": Type.Optional(Type.String()), "battleFormat": Type.Optional(Type.String()), "isReflect": Type.Optional(Type.Boolean()), "isLightScreen": Type.Optional(Type.Boolean()), "isAuroraVeil": Type.Optional(Type.Boolean()), "isCriticalHit": Type.Optional(Type.Boolean()) })) }),
    },
    {
      name: "analyze_party_weakness",
      label: "analyze_party_weakness",
      description: "パーティ各メンバーのタイプ相性データを集計し、弱点タイプ・カバレッジ不足を分析する。",
      promptSnippet: "パーティ各メンバーのタイプ相性データを集計し、弱点タイプ・カバレッジ不足を分析する。",
      parameters: Type.Object({ "party": Type.Array(Type.Object({ "name": Type.String(), "nature": Type.Optional(Type.String()), "evs": Type.Optional(Type.Object({})), "ability": Type.Optional(Type.String()), "item": Type.Optional(Type.String()) }), { description: "パーティメンバー" }) }),
    },
    {
      name: "analyze_party_coverage",
      label: "analyze_party_coverage",
      description: "パーティの攻撃カバレッジを分析する。抜群を取れない防御タイプを特定する。",
      promptSnippet: "パーティの攻撃カバレッジを分析する。抜群を取れない防御タイプを特定する。",
      parameters: Type.Object({ "myParty": Type.Array(Type.Object({ "name": Type.String(), "nature": Type.Optional(Type.String()), "evs": Type.Optional(Type.Object({})), "ability": Type.Optional(Type.String()), "item": Type.Optional(Type.String()) }), { description: "自分のパーティ" }), "moves": Type.Optional(Type.Record(Type.String(), Type.Array(Type.String()), { description: "ポケモン名をキーに技名配列を値とするmap。省略時はlearnsetから全攻撃技を候補にする。" })) }),
    },
    {
      name: "analyze_selection",
      label: "analyze_selection",
      description: "6v6 パーティ間の全対面について、タイプ相性・素早さ比較・最大ダメージ見積もりをマトリクスで返す。メンバーは name だけでなく nature / evs(SP) / ability / item まで渡すこと（名前だけだと SP=0・持ち物なしとして計算され、実戦と違う結果になる）。対戦振り返りでは get_match の party を load_party に渡して詳細を取得してから呼ぶこと。",
      promptSnippet: "6v6 パーティ間の全対面について、タイプ相性・素早さ比較・最大ダメージ見積もりをマトリクスで返す。メンバーは name だけでなく nature / evs(SP) / ability / item まで渡すこと（名前だけだと SP=0・…",
      parameters: Type.Object({ "myParty": Type.Array(Type.Object({ "name": Type.String(), "nature": Type.Optional(Type.String()), "evs": Type.Optional(Type.Object({})), "ability": Type.Optional(Type.String()), "item": Type.Optional(Type.String()) }), { description: "自分のパーティ" }), "opponentParty": Type.Array(Type.Object({ "name": Type.String(), "nature": Type.Optional(Type.String()), "evs": Type.Optional(Type.Object({})), "ability": Type.Optional(Type.String()), "item": Type.Optional(Type.String()) }), { description: "相手のパーティ" }), "battleFormat": StringEnum(["singles","doubles"] as const), "moves": Type.Optional(Type.Object({}, { description: "ポケモン名ごとに候補技を指定する" })) }),
    },
    {
      name: "find_counters",
      label: "find_counters",
      description: "指定ポケモンの弱点タイプ攻撃技を持つポケモンを候補プールから抽出し、双方向ダメ計・素早さ・タイプ相性を返す。",
      promptSnippet: "指定ポケモンの弱点タイプ攻撃技を持つポケモンを候補プールから抽出し、双方向ダメ計・素早さ・タイプ相性を返す。",
      parameters: Type.Object({ "target": Type.Object({ "name": Type.String(), "nature": Type.Optional(Type.String()), "evs": Type.Optional(Type.Object({})), "ability": Type.Optional(Type.String()), "item": Type.Optional(Type.String()), "boosts": Type.Optional(Type.Object({})), "status": Type.Optional(Type.String()) }, { description: "対策したい相手ポケモン" }), "candidatePool": Type.Optional(Type.Array(Type.Union([Type.String(), Type.Object({ "name": Type.String(), "nature": Type.Optional(Type.String()), "evs": Type.Optional(Type.Object({})), "ability": Type.Optional(Type.String()), "item": Type.Optional(Type.String()) })]), { description: "候補プール" })), "battleFormat": Type.Optional(StringEnum(["singles","doubles"] as const)) }),
    },
    {
      name: "compare_parties",
      label: "compare_parties",
      description: "2 つのパーティの統計差分を比較する。メンバー差分・タイプ分布・弱点/耐性/カバレッジ・素早さ分布を返す。",
      promptSnippet: "2 つのパーティの統計差分を比較する。メンバー差分・タイプ分布・弱点/耐性/カバレッジ・素早さ分布を返す。",
      parameters: Type.Object({ "partyA": Type.Array(Type.Object({ "name": Type.String(), "nature": Type.Optional(Type.String()), "evs": Type.Optional(Type.Object({})), "ability": Type.Optional(Type.String()), "item": Type.Optional(Type.String()) }), { description: "比較対象パーティA" }), "partyB": Type.Array(Type.Object({ "name": Type.String(), "nature": Type.Optional(Type.String()), "evs": Type.Optional(Type.Object({})), "ability": Type.Optional(Type.String()), "item": Type.Optional(Type.String()) }), { description: "比較対象パーティB" }), "labels": Type.Optional(Type.Object({ "partyA": Type.Optional(Type.String()), "partyB": Type.Optional(Type.String()) })) }),
    },
    {
      name: "list_parties",
      label: "list_parties",
      description: "保存済みパーティの一覧（サマリ）を返す。",
      promptSnippet: "保存済みパーティの一覧（サマリ）を返す。",
      parameters: Type.Object({}),
    },
    {
      name: "load_party",
      label: "load_party",
      description: "保存済みパーティを name 指定で 1 件取得し、各メンバーの持ち物・技・性格・SP を含む完全な構成を返す。対戦振り返りでは get_match の party をそのまま渡して自分のパーティ詳細を取得すること。",
      promptSnippet: "保存済みパーティを name 指定で 1 件取得し、各メンバーの持ち物・技・性格・SP を含む完全な構成を返す。対戦振り返りでは get_match の party をそのまま渡して自分のパーティ詳細を取得すること。",
      parameters: Type.Object({ "name": Type.String({ description: "取得するパーティ名" }) }),
    },
    {
      name: "save_party",
      label: "save_party",
      description: "パーティを保存する（upsert）。同名のパーティは上書きされる。",
      promptSnippet: "パーティを保存する（upsert）。同名のパーティは上書きされる。",
      parameters: Type.Object({ "name": Type.String({ description: "パーティの識別子" }), "memo": Type.Optional(Type.String({ description: "自由記述メモ" })), "members": Type.Array(Type.Object({ "name": Type.String({ description: "ポケモン名" }), "nature": Type.Optional(Type.String({ description: "性格名" })), "ability": Type.Optional(Type.String({ description: "特性名" })), "item": Type.Optional(Type.String({ description: "持ち物名" })), "evs": Type.Optional(Type.Object({ "hp": Type.Optional(Type.Integer()), "atk": Type.Optional(Type.Integer()), "def": Type.Optional(Type.Integer()), "spa": Type.Optional(Type.Integer()), "spd": Type.Optional(Type.Integer()), "spe": Type.Optional(Type.Integer()) }, { description: "能力ポイント(SP)" })), "moves": Type.Optional(Type.Array(Type.String(), { description: "技リスト（最大4）" })) }), { description: "パーティメンバー" }) }),
    },
    {
      name: "delete_party",
      label: "delete_party",
      description: "保存済みパーティを name 指定で削除する。",
      promptSnippet: "保存済みパーティを name 指定で削除する。",
      parameters: Type.Object({ "name": Type.String({ description: "削除するパーティ名" }) }),
    },
    {
      name: "import_party_from_text",
      label: "import_party_from_text",
      description: "ポケソルテキストからパーティを一括取り込みして保存する。",
      promptSnippet: "ポケソルテキストからパーティを一括取り込みして保存する。",
      parameters: Type.Object({ "text": Type.String({ description: "ポケソルテキスト" }), "name": Type.String({ description: "保存名" }), "memo": Type.Optional(Type.String({ description: "構築メモ" })) }),
    },
    {
      name: "list_matches",
      label: "list_matches",
      description: "自分が投稿した対戦動画に含まれる対戦の一覧を取得する。1つの動画に複数の対戦が入っているため、振り返りたい対戦を選ぶために最初に呼ぶ。各対戦の matchId・勝敗・相手の先発・使用パーティが分かる。URL に再生位置（t=）が含まれていれば、その位置の対戦を matchAtTimestamp として示す。",
      promptSnippet: "自分が投稿した対戦動画に含まれる対戦の一覧を取得する。1つの動画に複数の対戦が入っているため、振り返りたい対戦を選ぶために最初に呼ぶ。各対戦の matchId・勝敗・相手の先発・使用パーティが分かる。URL に再生位置（t=）が含まれていれ…",
      parameters: Type.Object({ "video": Type.String({ description: "YouTube の URL または 11 文字の動画 ID。URL は再生位置（t=）を含めたまま、利用者が貼ったとおりに渡すこと" }) }),
    },
    {
      name: "get_match",
      label: "get_match",
      description: "1つの対戦の記録を取得する。相手の構築6体・相手の先発・自分のパーティ名（party）と6体構成（team）・自分の先発と選出・勝敗・動画の該当位置が分かる。選出・先発の体数は battleFormat に応じ、シングルは選出 3 体／先発 1 体、ダブルは選出 4 体／先発 2 体。技やダメージなどの行動ログは記録されていないため、選出や構築相性の振り返りに使うこと。持ち物・技などのパーティ詳細が必要なら、party を load_party に渡して保存済みパーティを取得する。",
      promptSnippet: "1つの対戦の記録を取得する。相手の構築6体・相手の先発・自分のパーティ名（party）と6体構成（team）・自分の先発と選出・勝敗・動画の該当位置が分かる。選出・先発の体数は battleFormat に応じ、シングルは選出 3 体／先発…",
      parameters: Type.Object({ "matchId": Type.String({ description: "list_matches が返した matchId" }) }),
    },
    {
      name: "get_party_from_matches",
      label: "get_party_from_matches",
      description: "対戦記録に登場する自分のパーティの情報を取得する。name 省略時は記録に登場するパーティの一覧（使用回数・勝敗）を返す。name 指定時はそのパーティの 6 体構成と、そのパーティを使った直近の対戦（最大 10 戦）を返す。パーティ名は list_matches / get_match の party フィールドで確認できる。持ち物・技・努力値などの詳細が必要な場合は、保存済みパーティ（load_party）に party を渡して取得すること。",
      promptSnippet: "対戦記録に登場する自分のパーティの情報を取得する。name 省略時は記録に登場するパーティの一覧（使用回数・勝敗）を返す。name 指定時はそのパーティの 6 体構成と、そのパーティを使った直近の対戦（最大 10 戦）を返す。パーティ名は …",
      parameters: Type.Object({ "name": Type.Optional(Type.String({ description: "パーティ名（list_matches / get_match の party フィールドと同じ値）。省略時は一覧を返す" })) }),
    },
    {
      name: "get_match_review",
      label: "get_match_review",
      description: "過去に保存された対戦の振り返り（AI が行った振り返りの結論）を matchId 指定で取得する。振り返りは list_matches → get_match の流れで振り返った際に自動で保存される。セッションが切れても「前回の振り返りで決めた改善点」を思い出すために使う。",
      promptSnippet: "過去に保存された対戦の振り返り（AI が行った振り返りの結論）を matchId 指定で取得する。振り返りは list_matches → get_match の流れで振り返った際に自動で保存される。セッションが切れても「前回の振り返りで決…",
      parameters: Type.Object({ "matchId": Type.String({ description: "list_matches が返した matchId" }) }),
    },
    {
      name: "import_theory_from_url",
      label: "import_theory_from_url",
      description: "ポケモン徹底攻略(yakkun.com)のポケモンチャンピオンズ育成論のURLを取り込み、型（性格・特性・持ち物・SP配分・技）と考察本文（調整意図・与/被ダメ計・立ち回り・苦手対面）を取得する。利用者が育成論のURLを貼って取り込みを求めたらこのツールを呼ぶ。",
      promptSnippet: "ポケモン徹底攻略(yakkun.com)のポケモンチャンピオンズ育成論のURLを取り込み、型（性格・特性・持ち物・SP配分・技）と考察本文（調整意図・与/被ダメ計・立ち回り・苦手対面）を取得する。利用者が育成論のURLを貼って取り込みを求め…",
      parameters: Type.Object({ "url": Type.String({ description: "育成論のURL（例: https://yakkun.com/ch/theory/n413）。#以降のフラグメントは無視される" }) }),
    },
    {
      name: "get_theory",
      label: "get_theory",
      description: "過去に取り込んだ育成論をURL指定で再取得する。取り込み済みでない場合はエラーを返すので、そのときは import_theory_from_url を呼ぶこと。",
      promptSnippet: "過去に取り込んだ育成論をURL指定で再取得する。取り込み済みでない場合はエラーを返すので、そのときは import_theory_from_url を呼ぶこと。",
      parameters: Type.Object({ "url": Type.String({ description: "取り込んだ育成論のURL" }) }),
    },
    {
      name: "get_usage_ranking",
      label: "get_usage_ranking",
      description: "ポケモンチャンピオンズの使用率ランキング（順位表）を取得する。シングル／ダブルを rule で選ぶ。返るのは順位とポケモン名のみで、数値の使用率（%）は公開されていないため、「◯%使われている」とは言わず「◯位」と答えること。また必ず updatedAt を「◯月◯日時点」と明示すること。特定のポケモンの順位だけを知りたいときは pokemon を指定する。",
      promptSnippet: "ポケモンチャンピオンズの使用率ランキング（順位表）を取得する。シングル／ダブルを rule で選ぶ。返るのは順位とポケモン名のみで、数値の使用率（%）は公開されていないため、「◯%使われている」とは言わず「◯位」と答えること。また必ず up…",
      parameters: Type.Object({ "rule": Type.Optional(StringEnum(["single","double"] as const, { description: "シングルバトルの順位なら single、ダブルバトルなら double。省略時は single" })), "top": Type.Optional(Type.Number({ description: "上位何件まで返すか（1〜100）。省略時は全件（100 件）" })), "pokemon": Type.Optional(Type.String({ description: "特定のポケモンの順位だけを調べる場合のポケモン名（例: ガブリアス、メガゲンガー）。省略時は一覧を返す" })) }),
    },
  ];

  for (const tool of tools) {
    const name = tool.name;
    pi.registerTool({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      promptSnippet: tool.promptSnippet,
      parameters: tool.parameters,
      async execute(_toolCallId, params, signal) {
        const response = await fetch(`${BRIDGE_URL}/api/tools/${name}/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: USER_ID, args: params }),
          signal,
        });
        const data = await response.json();
        if (data.success !== true) {
          throw new Error(data.error ?? `rotom bridge error (HTTP ${response.status})`);
        }
        const text = data.content?.[0]?.text ?? "";
        return { content: [{ type: "text", text }], details: {} };
      },
    });
  }
}

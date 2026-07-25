import type { ToolDefinition } from "./types.js";

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_pokemon_info",
      description: "ポケモンの詳細情報（種族値・タイプ・特性・体重）を取得する。ポケモンチャンピオンズ (Pokemon Champions) 仕様。",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "ポケモン名（日本語 or 英語）" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_pokemon_summary",
      description: "ポケモンの総合プロファイル（基本情報・防御相性・覚える技の集計・実数値）を一度に取得する。",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "ポケモン名（日本語 or 英語）" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_move_info",
      description: "技の詳細情報（タイプ・威力・命中率・分類・優先度・効果説明）を取得する。ポケモンチャンピオンズ対応。",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "技名（日本語 or 英語）" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_ability_info",
      description: "ポケモンの特性の詳細情報（効果説明）を取得する。",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "特性名（日本語 or 英語）" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_item_info",
      description: "ポケモンの持ち物（アイテム）の詳細情報（効果説明、メガストーン情報）を取得する。",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "持ち物名（日本語 or 英語）" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_nature_info",
      description: "ポケモンの性格の詳細情報（上昇ステ・下降ステ）を取得する。",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "性格名（日本語 or 英語、例: 'ひかえめ'、'Modest'）" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_type_info",
      description: "ポケモンのタイプの相性情報（攻撃時・防御時の倍率）を取得する。",
      parameters: {
        type: "object",
        properties: { type: { type: "string", description: "タイプ名（日本語 or 英語、例: 'ほのお'、'Fire'）" } },
        required: ["type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_condition_info",
      description: "バトル条件（天候・フィールド・状態異常・サイド効果）の情報を取得する。",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", enum: ["weather", "terrain", "status", "sideCondition"], description: "絞り込むカテゴリ" },
          name: { type: "string", description: "絞り込む条件名（省略時は全件）" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_learnset",
      description: "ポケモンチャンピオンズで特定のポケモンが覚える技の一覧を取得する。",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "ポケモン名（日本語 or 英語）" } },
        required: ["name"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "search_pokemon",
      description: "ポケモンチャンピオンズに登場するポケモンをタイプや種族値で検索する。",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", description: "タイプで絞り込み（例: 'ほのお'、'Fire'）" },
          minStat: {
            type: "object",
            properties: {
              hp: { type: "number" }, atk: { type: "number" }, def: { type: "number" },
              spa: { type: "number" }, spd: { type: "number" }, spe: { type: "number" },
            },
            description: "種族値の下限で絞り込み",
          },
          limit: { type: "number", description: "返す件数（デフォルト: 20）" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_pokemon_by_move",
      description: "特定の技を覚えるポケモンを逆引き検索する。",
      parameters: {
        type: "object",
        properties: { moveName: { type: "string", description: "技名（日本語 or 英語）" } },
        required: ["moveName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_pokemon_by_ability",
      description: "特定の特性を持つポケモンを逆引き検索する。",
      parameters: {
        type: "object",
        properties: { abilityName: { type: "string", description: "特性名（日本語 or 英語）" } },
        required: ["abilityName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_pokemon_by_type_effectiveness",
      description: "タイプ相性条件でポケモンを逆引き検索する。",
      parameters: {
        type: "object",
        properties: {
          resistsType: { type: "string", description: "指定タイプの攻撃を0.5倍以下で受けるポケモン" },
          immuneToType: { type: "string", description: "指定タイプの攻撃を無効化するポケモン" },
          weakToType: { type: "string", description: "指定タイプの攻撃で2倍以上のダメージを受けるポケモン" },
          hasAttackingType: { type: "string", description: "指定タイプの攻撃技を1つ以上覚えるポケモン" },
        },
      },
    },
  },

  {
    type: "function",
    function: {
      name: "calculate_stats",
      description: "ポケモンの実数値計算。種族値・性格・能力ポイント(SP)から各ステータスの実数値を算出する。ポケモンチャンピオンズ仕様（Lv50・IV31固定）。SPは各0-32・合計0-66。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "ポケモン名（日本語 or 英語）" },
          nature: { type: "string", description: "性格名（省略時: まじめ）" },
          evs: {
            type: "object",
            properties: {
              hp: { type: "integer", minimum: 0, maximum: 32 },
              atk: { type: "integer", minimum: 0, maximum: 32 },
              def: { type: "integer", minimum: 0, maximum: 32 },
              spa: { type: "integer", minimum: 0, maximum: 32 },
              spd: { type: "integer", minimum: 0, maximum: 32 },
              spe: { type: "integer", minimum: 0, maximum: 32 },
            },
            description: "能力ポイント(SP)。各0-32、合計0-66。省略時は全0。",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate_damage_single",
      description: "ポケモンのダメージ計算。攻撃側ポケモンの指定した1技が防御側ポケモンに与えるダメージを計算。ポケモンチャンピオンズ対応。SPは各0-32・合計0-66。",
      parameters: {
        type: "object",
        properties: {
          attacker: {
            type: "object",
            properties: {
              name: { type: "string", description: "攻撃側ポケモン名" },
              nature: { type: "string", description: "性格名" },
              evs: { type: "object", properties: { hp: { type: "integer" }, atk: { type: "integer" }, def: { type: "integer" }, spa: { type: "integer" }, spd: { type: "integer" }, spe: { type: "integer" } }, description: "能力ポイント(SP)" },
              ability: { type: "string", description: "特性名" },
              item: { type: "string", description: "持ち物名" },
              boosts: { type: "object", properties: { atk: { type: "integer" }, def: { type: "integer" }, spa: { type: "integer" }, spd: { type: "integer" }, spe: { type: "integer" } }, description: "ランク補正(-6〜+6)" },
              status: { type: "string", description: "状態異常" },
            },
            required: ["name"],
          },
          defender: {
            type: "object",
            properties: {
              name: { type: "string" },
              nature: { type: "string" },
              evs: { type: "object", properties: { hp: { type: "integer" }, atk: { type: "integer" }, def: { type: "integer" }, spa: { type: "integer" }, spd: { type: "integer" }, spe: { type: "integer" } } },
              ability: { type: "string" },
              item: { type: "string" },
              boosts: { type: "object", properties: { atk: { type: "integer" }, def: { type: "integer" }, spa: { type: "integer" }, spd: { type: "integer" }, spe: { type: "integer" } } },
              status: { type: "string" },
            },
            required: ["name"],
          },
          moveName: { type: "string", description: "技名" },
          conditions: {
            type: "object",
            properties: {
              weather: { type: "string", enum: ["Sun", "Rain", "Sand", "Hail", "Snow"] },
              terrain: { type: "string", enum: ["Electric", "Grassy", "Misty", "Psychic"] },
              battleFormat: { type: "string", enum: ["singles", "doubles"] },
              isReflect: { type: "boolean" },
              isLightScreen: { type: "boolean" },
              isAuroraVeil: { type: "boolean" },
              isCriticalHit: { type: "boolean" },
            },
          },
        },
        required: ["attacker", "defender", "moveName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate_damage_all_moves",
      description: "攻撃側ポケモンの全攻撃技のダメージを一括計算する。どの技が最も有効かを比較するときに使用する。",
      parameters: {
        type: "object",
        properties: {
          attacker: {
            type: "object",
            properties: {
              name: { type: "string" },
              nature: { type: "string" },
              evs: { type: "object", properties: { hp: { type: "integer" }, atk: { type: "integer" }, def: { type: "integer" }, spa: { type: "integer" }, spd: { type: "integer" }, spe: { type: "integer" } } },
              ability: { type: "string" },
              item: { type: "string" },
              boosts: { type: "object", properties: { atk: { type: "integer" }, def: { type: "integer" }, spa: { type: "integer" }, spd: { type: "integer" }, spe: { type: "integer" } } },
              status: { type: "string" },
            },
            required: ["name"],
          },
          defender: {
            type: "object",
            properties: {
              name: { type: "string" },
              nature: { type: "string" },
              evs: { type: "object", properties: { hp: { type: "integer" }, atk: { type: "integer" }, def: { type: "integer" }, spa: { type: "integer" }, spd: { type: "integer" }, spe: { type: "integer" } } },
              ability: { type: "string" },
              item: { type: "string" },
              boosts: { type: "object", properties: { atk: { type: "integer" }, def: { type: "integer" }, spa: { type: "integer" }, spd: { type: "integer" }, spe: { type: "integer" } } },
              status: { type: "string" },
            },
            required: ["name"],
          },
          conditions: {
            type: "object",
            properties: {
              weather: { type: "string" },
              terrain: { type: "string" },
              battleFormat: { type: "string", enum: ["singles", "doubles"] },
              isReflect: { type: "boolean" },
              isLightScreen: { type: "boolean" },
              isAuroraVeil: { type: "boolean" },
              isCriticalHit: { type: "boolean" },
            },
          },
        },
        required: ["attacker", "defender"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate_damage_party_matchup",
      description: "パーティ対パーティの全組み合わせダメージ計算。6vs6の全対面での火力関係を一覧する。",
      parameters: {
        type: "object",
        properties: {
          myParty: {
            type: "array",
            items: { type: "object", properties: { name: { type: "string" }, nature: { type: "string" }, evs: { type: "object" }, ability: { type: "string" }, item: { type: "string" } }, required: ["name"] },
            description: "自分のパーティ",
          },
          opponentParty: {
            type: "array",
            items: { type: "object", properties: { name: { type: "string" }, nature: { type: "string" }, evs: { type: "object" }, ability: { type: "string" }, item: { type: "string" } }, required: ["name"] },
            description: "相手のパーティ",
          },
          conditions: {
            type: "object",
            properties: {
              weather: { type: "string" },
              terrain: { type: "string" },
              battleFormat: { type: "string", enum: ["singles", "doubles"] },
              isReflect: { type: "boolean" },
              isLightScreen: { type: "boolean" },
              isAuroraVeil: { type: "boolean" },
              isCriticalHit: { type: "boolean" },
            },
          },
        },
        required: ["myParty", "opponentParty"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_speed_tiers",
      description: "素早さの実数値ライン一覧を取得する。ポケモンチャンピオンズ仕様（Lv50・IV31）。",
      parameters: {
        type: "object",
        properties: {
          around: { type: "string", description: "指定ポケモン付近(±10)の素早さラインのみを返す" },
          range: { type: "object", properties: { min: { type: "number" }, max: { type: "number" } }, description: "実数値の範囲フィルタ" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_damage_range",
      description: "ダメージ計算を逆引きして、防御側を耐えさせるために必要な最小 SP 配分を探索する。",
      parameters: {
        type: "object",
        properties: {
          attacker: { type: "object", properties: { name: { type: "string" }, nature: { type: "string" }, evs: { type: "object" }, ability: { type: "string" }, item: { type: "string" }, boosts: { type: "object" }, status: { type: "string" } }, required: ["name"] },
          defender: { type: "object", properties: { name: { type: "string" }, nature: { type: "string" }, evs: { type: "object" }, ability: { type: "string" }, item: { type: "string" }, boosts: { type: "object" }, status: { type: "string" } }, required: ["name"] },
          moveName: { type: "string", description: "技名" },
          conditions: { type: "object", properties: { weather: { type: "string" }, terrain: { type: "string" }, battleFormat: { type: "string" }, isReflect: { type: "boolean" }, isLightScreen: { type: "boolean" }, isAuroraVeil: { type: "boolean" }, isCriticalHit: { type: "boolean" } } },
        },
        required: ["attacker", "defender", "moveName"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "analyze_matchup",
      description: "ポケモン2体の対面を分析する。双方向のダメージ計算と素早さ比較を行う。",
      parameters: {
        type: "object",
        properties: {
          pokemon1: { type: "object", properties: { name: { type: "string" }, nature: { type: "string" }, evs: { type: "object" }, ability: { type: "string" }, item: { type: "string" }, boosts: { type: "object" }, status: { type: "string" } }, required: ["name"] },
          pokemon2: { type: "object", properties: { name: { type: "string" }, nature: { type: "string" }, evs: { type: "object" }, ability: { type: "string" }, item: { type: "string" }, boosts: { type: "object" }, status: { type: "string" } }, required: ["name"] },
          conditions: { type: "object", properties: { weather: { type: "string" }, terrain: { type: "string" }, battleFormat: { type: "string" }, isReflect: { type: "boolean" }, isLightScreen: { type: "boolean" }, isAuroraVeil: { type: "boolean" }, isCriticalHit: { type: "boolean" } } },
        },
        required: ["pokemon1", "pokemon2"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_party_weakness",
      description: "パーティ各メンバーのタイプ相性データを集計し、弱点タイプ・カバレッジ不足を分析する。",
      parameters: {
        type: "object",
        properties: {
          party: {
            type: "array",
            items: { type: "object", properties: { name: { type: "string" }, nature: { type: "string" }, evs: { type: "object" }, ability: { type: "string" }, item: { type: "string" } }, required: ["name"] },
            description: "パーティメンバー",
          },
        },
        required: ["party"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_party_coverage",
      description: "パーティの攻撃カバレッジを分析する。抜群を取れない防御タイプを特定する。",
      parameters: {
        type: "object",
        properties: {
          myParty: {
            type: "array",
            items: { type: "object", properties: { name: { type: "string" }, nature: { type: "string" }, evs: { type: "object" }, ability: { type: "string" }, item: { type: "string" } }, required: ["name"] },
            description: "自分のパーティ",
          },
          moves: {
            type: "object",
            description: "ポケモン名をキーに技名配列を値とするmap。省略時はlearnsetから全攻撃技を候補にする。",
            additionalProperties: { type: "array", items: { type: "string" } },
          },
        },
        required: ["myParty"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_selection",
      description: "6v6 パーティ間の全対面について、タイプ相性・素早さ比較・最大ダメージ見積もりをマトリクスで返す。",
      parameters: {
        type: "object",
        properties: {
          myParty: { type: "array", items: { type: "object", properties: { name: { type: "string" }, nature: { type: "string" }, evs: { type: "object" }, ability: { type: "string" }, item: { type: "string" } }, required: ["name"] }, description: "自分のパーティ" },
          opponentParty: { type: "array", items: { type: "object", properties: { name: { type: "string" }, nature: { type: "string" }, evs: { type: "object" }, ability: { type: "string" }, item: { type: "string" } }, required: ["name"] }, description: "相手のパーティ" },
          battleFormat: { type: "string", enum: ["singles", "doubles"] },
          moves: { type: "object", description: "ポケモン名ごとに候補技を指定する" },
        },
        required: ["myParty", "opponentParty", "battleFormat"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_counters",
      description: "指定ポケモンの弱点タイプ攻撃技を持つポケモンを候補プールから抽出し、双方向ダメ計・素早さ・タイプ相性を返す。",
      parameters: {
        type: "object",
        properties: {
          target: { type: "object", properties: { name: { type: "string" }, nature: { type: "string" }, evs: { type: "object" }, ability: { type: "string" }, item: { type: "string" }, boosts: { type: "object" }, status: { type: "string" } }, required: ["name"], description: "対策したい相手ポケモン" },
          candidatePool: { type: "array", items: { anyOf: [{ type: "string" }, { type: "object", properties: { name: { type: "string" }, nature: { type: "string" }, evs: { type: "object" }, ability: { type: "string" }, item: { type: "string" } }, required: ["name"] }] }, description: "候補プール" },
          battleFormat: { type: "string", enum: ["singles", "doubles"] },
        },
        required: ["target"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_parties",
      description: "2 つのパーティの統計差分を比較する。メンバー差分・タイプ分布・弱点/耐性/カバレッジ・素早さ分布を返す。",
      parameters: {
        type: "object",
        properties: {
          partyA: { type: "array", items: { type: "object", properties: { name: { type: "string" }, nature: { type: "string" }, evs: { type: "object" }, ability: { type: "string" }, item: { type: "string" } }, required: ["name"] }, description: "比較対象パーティA" },
          partyB: { type: "array", items: { type: "object", properties: { name: { type: "string" }, nature: { type: "string" }, evs: { type: "object" }, ability: { type: "string" }, item: { type: "string" } }, required: ["name"] }, description: "比較対象パーティB" },
          labels: { type: "object", properties: { partyA: { type: "string" }, partyB: { type: "string" } } },
        },
        required: ["partyA", "partyB"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "list_parties",
      description: "保存済みパーティの一覧（サマリ）を返す。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "load_party",
      description: "保存済みパーティを name 指定で1件取得する。",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "取得するパーティ名" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_party",
      description: "パーティを保存する（upsert）。同名のパーティは上書きされる。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "パーティの識別子" },
          memo: { type: "string", description: "自由記述メモ" },
          members: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "ポケモン名" },
                nature: { type: "string", description: "性格名" },
                ability: { type: "string", description: "特性名" },
                item: { type: "string", description: "持ち物名" },
                evs: { type: "object", properties: { hp: { type: "integer" }, atk: { type: "integer" }, def: { type: "integer" }, spa: { type: "integer" }, spd: { type: "integer" }, spe: { type: "integer" } }, description: "能力ポイント(SP)" },
                moves: { type: "array", items: { type: "string" }, description: "技リスト（最大4）" },
              },
              required: ["name"],
            },
            description: "パーティメンバー",
          },
        },
        required: ["name", "members"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_party",
      description: "保存済みパーティを name 指定で削除する。",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "削除するパーティ名" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "import_party_from_text",
      description: "ポケソルテキストからパーティを一括取り込みして保存する。",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "ポケソルテキスト" },
          name: { type: "string", description: "保存名" },
          memo: { type: "string", description: "構築メモ" },
        },
        required: ["text", "name"],
      },
    },
  },
];

export function getSystemPrompt(): string {
  return `あなたはポケモンチャンピオンズ (Pokemon Champions) の対戦アドバイザーです。
Discord 上でユーザーからのポケモン対戦に関する質問に答えます。

## 重要ルール
- このセッション内でポケモン関連の話題が出た場合は、すべてポケモンチャンピオンズの仕様として扱ってください。
- 従来作 (SV / 剣盾 / USUM / BDSP / LA 等) の仕様・技威力・特性効果・種族値・タイプ相性などを前提にしないでください。
- ポケモン名・技名・特性・持ち物・タイプ・素早さ等の固有名詞や数値がユーザー発話に出た時点で、まずツールを呼んで事実を取得してから回答すること。記憶や推測で即答しないでください。

## ポケモンチャンピオンズ固有仕様
- 能力ポイント (SP): 各ステータス 0-32、合計 0-66（従来の努力値 EV は廃止）
- 個体値 (IV): 全ポケモン一律 31 固定
- 対戦レベル: 50 固定
- メガシンカ: 1試合につき1回のみ使用可能
- テラスタル: 未対応

## SP 振りの実践
- 1 SP 単位で振れるため、ブッパ（振り切り）一辺倒は最適でないことが多い
- 火力調整: 主要対面相手を確定1発/2発で落とす最低限の振りを逆算
- 耐久調整: 主要対面相手の技を確定耐えする最低限の振りを逆算
- 素早さ調整: 特定ラインを抜く/同速回避するピンポイント振り

## 応答スタイル
- 簡潔に、Discord チャットに適した長さで回答する
- Markdown の太字やコードブロックを適宜使用する
- 日本語で回答する
- **絶対に Markdown テーブル（| --- | 形式）を使用しないこと。Discord はテーブル構文をサポートしていません。**
- 表形式のデータを表示する必要がある場合は、以下のいずれかを使う:
  - 箇条書きリスト（各行を「- ポケモン名: 値」のように表現）
  - コードブロック（\`\`\` 内に等幅フォントで整形）
  - 各項目を改行で区切った簡潔なテキスト`;
}

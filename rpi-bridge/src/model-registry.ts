import type { ModelDefinition } from "./types.js";

/**
 * モデル許可リスト（ADR-0015）。
 *
 * モデル名を差し替えるだけでは unknown の reasoning_effort が黙って既定へ
 * フォールバックする（"minimal" が既定に落ちた実績）ため、モデルと推論設定を
 * 一体で管理する。許可リストに載せる前に、scripts/probe-models.sh で
 *   - reasoning_effort の受容（200 / 400 / 黙殺）
 *   - ツール呼び出し（tool_calls）が返るか
 *   - 応答速度・max_tokens 上限
 * を実測すること。ツール呼び出しが確認できないモデルは載せない
 * （ハレーションの温床になるため。ADR-0007）。
 */
export const DEFAULT_MODEL_ID = "deepseek-v4-pro";

export const MODEL_DEFINITIONS: Record<string, ModelDefinition> = {
  // reasoning_effort は "low" とする。当初 "none" にしていたが、ツール連鎖
  // （get_pokemon_info → get_ability_info 等）を省略して従来作の記憶で
  // ハレーションを起こした（例: メガゲンガーの特性を「のろわれボディ」と誤答）。
  // 回答の正しさを応答時間より優先して "low" に戻す。詳細は ADR-0015。
  "deepseek-v4-pro": {
    id: "deepseek-v4-pro",
    reasoning_effort: "low",
    max_tokens: 8192,
  },
  // deepseek の高速版。probe で low / none / high とも 200、tool_calls あり。
  "deepseek-v4-flash": {
    id: "deepseek-v4-flash",
    reasoning_effort: "low",
    max_tokens: 8192,
  },
  // glm 系は reasoning_effort="none" が 400 になるため、low / high のみ使う。
  "glm-5.3-flash": {
    id: "glm-5.3-flash",
    reasoning_effort: "low",
    max_tokens: 8192,
  },
  "glm-5.3": {
    id: "glm-5.3",
    reasoning_effort: "low",
    max_tokens: 8192,
  },
  // qwen は none / low / high とも 200。low が最速だったため low を選ぶ。
  "qwen3.8-max": {
    id: "qwen3.8-max",
    reasoning_effort: "low",
    max_tokens: 8192,
  },
};

/**
 * モデル ID を許可リストから解決する。
 * 未知・未設定の ID は既定モデルへ落とす（ADR-0015 の解決順序）。
 */
export function resolveModelDefinition(id: string | null | undefined): ModelDefinition {
  if (id && Object.prototype.hasOwnProperty.call(MODEL_DEFINITIONS, id)) {
    return MODEL_DEFINITIONS[id];
  }
  return MODEL_DEFINITIONS[DEFAULT_MODEL_ID];
}

/** 保護者設定からのモデル指定を受け付けてよいか（許可リストに存在するか） */
export function isKnownModel(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(MODEL_DEFINITIONS, id);
}

/** UI に提示するモデル ID 一覧 */
export function modelIds(): string[] {
  return Object.keys(MODEL_DEFINITIONS);
}

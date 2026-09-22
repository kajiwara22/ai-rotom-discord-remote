/**
 * pi 連携（ADR-0020 の後続）の生成スクリプト。
 *
 * rpi-bridge/src/tool-definitions.ts（ツール定義・システムプロンプトの単一の正）から、
 * pi 用の成果物を生成する:
 *   - .pi/extensions/rotom.ts       … JSON Schema → TypeBox 化したツール定義を含む
 *                                      完全な extension（自動ロード対象）
 *   - .pi/skills/rotom/SKILL.md     … 対戦アドバイザーのシステムプロンプト（skill）
 *
 * 再生成コマンド（リポジトリルートで）:
 *   cd rpi-bridge && node --import tsx ../scripts/generate-pi.ts
 *
 * ツールを追加・変更したら必ず再生成する（生成物は手編集しない）。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_DEFINITIONS, getSystemPrompt } from "../rpi-bridge/src/tool-definitions.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXT_DIR = resolve(REPO_ROOT, ".pi/extensions");
const SKILL_DIR = resolve(REPO_ROOT, ".pi/skills/rotom");

// ============ JSON Schema → TypeBox 変換 ============

type JsonSchema = {
  type?: string;
  description?: string;
  enum?: unknown[];
  anyOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: JsonSchema;
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
};

/**
 * ブリッジの JSON Schema（OpenAI ツール引数形式）を TypeBox 式の文字列へ変換する。
 *
 * ブリッジ側で使われている構文のみを対象とする:
 *   object / string / number / integer / boolean / array / enum / anyOf / additionalProperties
 * 文字列 enum は Google 互換の StringEnum（@earendil-works/pi-ai）へ落とす。
 */
function schemaToTypeBox(schema: JsonSchema): string {
  const desc = schema.description;
  const descOpt = desc !== undefined ? `{ description: ${JSON.stringify(desc)} }` : "";

  if (schema.enum !== undefined) {
    if (schema.enum.every((v) => typeof v === "string")) {
      return desc !== undefined
        ? `StringEnum(${JSON.stringify(schema.enum)} as const, ${descOpt})`
        : `StringEnum(${JSON.stringify(schema.enum)} as const)`;
    }
    return `Type.Union([${schema.enum
      .map((v) => `Type.Literal(${JSON.stringify(v)})`)
      .join(", ")}])`;
  }

  if (schema.anyOf !== undefined) {
    return `Type.Union([${schema.anyOf.map(schemaToTypeBox).join(", ")}])`;
  }

  // additionalProperties を持つ object は map（Record）として扱う
  if (schema.type === "object" && schema.additionalProperties !== undefined) {
    const value = schemaToTypeBox(schema.additionalProperties);
    return desc !== undefined
      ? `Type.Record(Type.String(), ${value}, ${descOpt})`
      : `Type.Record(Type.String(), ${value})`;
  }

  switch (schema.type) {
    case "object": {
      const props = Object.entries(schema.properties ?? {}).map(([key, sub]) => {
        const required = schema.required?.includes(key) ?? false;
        const expr = schemaToTypeBox(sub);
        return `${JSON.stringify(key)}: ${required ? expr : `Type.Optional(${expr})`}`;
      });
      const body = props.length > 0 ? `{ ${props.join(", ")} }` : "{}";
      return desc !== undefined
        ? `Type.Object(${body}, ${descOpt})`
        : `Type.Object(${body})`;
    }
    case "string":
      return desc !== undefined ? `Type.String(${descOpt})` : "Type.String()";
    case "number":
      return desc !== undefined ? `Type.Number(${descOpt})` : "Type.Number()";
    case "integer": {
      const opts: string[] = [];
      if (schema.minimum !== undefined) opts.push(`minimum: ${schema.minimum}`);
      if (schema.maximum !== undefined) opts.push(`maximum: ${schema.maximum}`);
      if (desc !== undefined) opts.push(`description: ${JSON.stringify(desc)}`);
      return opts.length > 0 ? `Type.Integer({ ${opts.join(", ")} })` : "Type.Integer()";
    }
    case "boolean":
      return desc !== undefined ? `Type.Boolean(${descOpt})` : "Type.Boolean()";
    case "array": {
      const items = schemaToTypeBox(schema.items ?? { type: "unknown" });
      return desc !== undefined ? `Type.Array(${items}, ${descOpt})` : `Type.Array(${items})`;
    }
    default:
      return "Type.Unknown()";
  }
}

// ============ .pi/extensions/rotom.ts の生成 ============

/** 全ツール共通の execute 本文（テンプレートリテラルを含むため文字列配列で組む） */
const EXECUTE_BODY = [
  "      async execute(_toolCallId, params, signal) {",
  "        const response = await fetch(`${BRIDGE_URL}/api/tools/${name}/run`, {",
  '          method: "POST",',
  '          headers: { "Content-Type": "application/json" },',
  "          body: JSON.stringify({ user_id: USER_ID, args: params }),",
  "          signal,",
  "        });",
  "        const data = await response.json();",
  "        if (data.success !== true) {",
  "          throw new Error(data.error ?? `rotom bridge error (HTTP ${response.status})`);",
  "        }",
  '        const text = data.content?.[0]?.text ?? "";',
  '        return { content: [{ type: "text", text }], details: {} };',
  "      },",
].join("\n");

function buildExtensionSource(): string {
  const header = [
    "// 自動生成: scripts/generate-pi.ts から生成。手編集しないこと。",
    "// 変更したい場合はスクリプト側を直して再生成する:",
    "//   cd rpi-bridge && node --import tsx ../scripts/generate-pi.ts",
    'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";',
    'import { Type } from "typebox";',
    'import { StringEnum } from "@earendil-works/pi-ai";',
    "",
    'const BRIDGE_URL = process.env.ROTOM_BRIDGE_URL ?? "http://127.0.0.1:3210";',
    'const USER_ID = process.env.ROTOM_USER_ID ?? "me";',
    "",
    "interface ToolEntry {",
    "  name: string;",
    "  label: string;",
    "  description: string;",
    "  promptSnippet: string;",
    "  parameters: any;",
    "}",
    "",
    "export default function rotomExtension(pi: ExtensionAPI) {",
    "  const tools: ToolEntry[] = [",
  ].join("\n");

  const toolLines: string[] = [];
  for (const def of TOOL_DEFINITIONS) {
    const fn = def.function;
    const params = schemaToTypeBox(fn.parameters as JsonSchema);
    const snippet =
      fn.description.length > 120 ? `${fn.description.slice(0, 120)}…` : fn.description;
    toolLines.push("    {");
    toolLines.push(`      name: ${JSON.stringify(fn.name)},`);
    toolLines.push(`      label: ${JSON.stringify(fn.name)},`);
    toolLines.push(`      description: ${JSON.stringify(fn.description)},`);
    toolLines.push(`      promptSnippet: ${JSON.stringify(snippet)},`);
    toolLines.push(`      parameters: ${params},`);
    toolLines.push("    },");
  }

  const footer = [
    "  ];",
    "",
    "  for (const tool of tools) {",
    "    const name = tool.name;",
    "    pi.registerTool({",
    "      name: tool.name,",
    "      label: tool.label,",
    "      description: tool.description,",
    "      promptSnippet: tool.promptSnippet,",
    "      parameters: tool.parameters,",
    EXECUTE_BODY,
    "    });",
    "  }",
    "}",
    "",
  ].join("\n");

  return `${header}\n${toolLines.join("\n")}\n${footer}`;
}

// ============ .pi/skills/rotom/SKILL.md の生成 ============

function buildSkillSource(): string {
  const frontmatter = [
    "---",
    "name: rotom",
    'description: "ポケモンチャンピオンズ (Pokemon Champions) のパーティ構築・対戦振り返り・ダメージ計算・タイプ相性・育成論など、ポケモン対戦の話題を扱うときに使う。"',
    "---",
    "",
    "# ポケモンチャンピオンズ対戦アドバイザー",
    "",
    "登録済みの rotom 系ツール（get_* / search_* / calculate_* / analyze_* / find_* / list_* / load_* / save_* / import_* / get_usage_ranking 等）を呼んで事実確認してから回答する。",
    "",
  ].join("\n");
  return `${frontmatter}${getSystemPrompt()}`;
}

// ============ 生成実行 ============

mkdirSync(EXT_DIR, { recursive: true });
mkdirSync(SKILL_DIR, { recursive: true });
writeFileSync(resolve(EXT_DIR, "rotom.ts"), buildExtensionSource());
writeFileSync(resolve(SKILL_DIR, "SKILL.md"), buildSkillSource());
console.log(`generated: .pi/extensions/rotom.ts (${TOOL_DEFINITIONS.length} tools)`);
console.log("generated: .pi/skills/rotom/SKILL.md");

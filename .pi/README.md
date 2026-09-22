# pi 連携（AIロトム）

pi web 上の pi エージェントから、`rpi-bridge` が公開する ai-rotom ツール群
（PT 構築・対戦振り返り・ダメージ計算など）を使うための extension と skill。

## 構成

```
.pi/
  extensions/
    rotom.ts          … ツール定義（TypeBox）+ ブリッジへの実行プロキシ
  skills/
    rotom/SKILL.md    … 対戦アドバイザーのシステムプロンプト（skill）
```

- `rotom.ts` は `scripts/generate-pi.ts` の**生成物**（手編集しない）
- `SKILL.md` も同じく生成物
- ツール定義・システムプロンプトの単一の正は `rpi-bridge/src/tool-definitions.ts`

## 有効化

1. このリポジトリを pi の信頼済みプロジェクトにする（未信頼なら信頼する）
2. pi で `/reload` する（`.pi/extensions/rotom.ts` が自動ロードされる）

使い方: そのままポケモンの相談をする。skill は話題に応じて自動ロードされ、
`/skill:rotom` で強制ロードもできる。

## 設定（環境変数）

| 変数 | 既定 | 説明 |
|---|---|---|
| `ROTOM_BRIDGE_URL` | `http://127.0.0.1:3210` | rpi-bridge の URL |
| `ROTOM_USER_ID` | `me` | ブリッジの Web ユーザー ID（パーティの名前空間になる） |

※ 個人利用では既定のままで動く。ブリッジを別ホストへ移した場合などに上書きする。

## 再生成

ツールを追加・変更したら（`rpi-bridge/src/tool-definitions.ts` を編集したら）、
リポジトリルートで次を実行して再生成する。

```bash
cd rpi-bridge && node --import tsx ../scripts/generate-pi.ts
```

## 前提

- `rpi-bridge` が起動していること（`/health` が 200）
- ブリッジの `POST /api/tools/:name/run`（ADR-0020）に依存

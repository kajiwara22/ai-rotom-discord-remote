# ai-rotom-discord-remote

Discord をインターフェースにして、スマホからでも [ai-rotom](https://github.com/nonz250/ai-rotom) (ポケモンチャンピオンズ対戦アドバイザー MCP サーバー) にアクセスできる Discord Bot。

## アーキテクチャ（ハイブリッド構成）

```
Discord (スマホ/PC)
    ↓ (Interactions 受信)
Cloudflare Worker (軽量プロキシ)
    ├── Discord 署名検証
    ├── deferredResponse() を返す (3秒以内)
    └── 非同期で Raspberry Pi に POST /ask
            ↓ (Cloudflare Tunnel + Access 認証)
Raspberry Pi (Node.js HTTP サーバー)
    ├── AI 処理実行 (OpenCode Go API)
    ├── セッション管理 (SQLite)
    ├── ツール呼び出しループ
    ├── MCP Bridge (ai-rotom stdio)
    └── Discord Webhook で応答編集
```

- **Cloudflare Worker**: Discord 受信 → 署名検証 → 即座に deferred response → Pi へ転送するだけの薄いプロキシ
- **Raspberry Pi**: AI 推論・ツール実行・セッション管理・Webhook 応答のすべてを担当
- **Cloudflare Tunnel + Access**: Worker ↔ Pi 間のセキュアな接続

### 旧構成との違い

| | 旧構成 | 新構成 |
|---|---|---|
| AI 処理 | Worker (Durable Object) | Raspberry Pi |
| セッション管理 | Durable Object (SQLite) | Raspberry Pi (SQLite) |
| ツール実行 | Worker → Tunnel → Pi | Pi 内でローカル実行 |
| Discord 応答 | Worker (Webhook PATCH) | Pi (Webhook PATCH) |
| デバッグ | wrangler tail のみ | VS Code リモートデバッグ可能 |

## セットアップ手順

### 1. Discord アプリケーションの作成

1. [Discord Developer Portal](https://discord.com/developers/applications) で New Application 作成
2. Bot タブ → Add Bot → 以下の情報をメモ:
   - `APPLICATION ID` (General Information タブ)
   - `PUBLIC KEY` (General Information タブ)
   - `TOKEN` (Bot タブ → Reset Token)
3. Bot タブで以下を有効化:
   - MESSAGE CONTENT INTENT: OFF（スラッシュコマンドのみなので不要）
4. サーバーに Bot を招待:
   ```
   https://discord.com/api/oauth2/authorize?client_id=YOUR_APPLICATION_ID&permissions=2147485696&scope=bot%20applications.commands
   ```

### 2. Workers のデプロイ

```bash
cd worker
cp .dev.vars.example .dev.vars
# .dev.vars を編集

pnpm install
npx wrangler deploy
```

デプロイ後、スラッシュコマンドを登録:

```bash
curl -X POST https://YOUR_WORKER.workers.dev/register
```

Interaction Endpoint URL を Discord Developer Portal に設定:
- URL: `https://YOUR_WORKER.workers.dev/interactions`
- General Information → INTERACTIONS ENDPOINT URL

#### デバッグ

```bash
wrangler tail
```

### 3. Raspberry Pi 側の準備

```bash
cd rpi-bridge
cp .env.example .env
# .env を編集（特に OPENCODE_GO_API_KEY を設定）
# BIND_HOST=0.0.0.0 で外部からの接続を許可

pnpm install
pnpm dev          # 通常起動
pnpm dev:inspect  # VS Code リモートデバッグ用 (port 9229)
```

デフォルトで `http://127.0.0.1:3210` で起動します。
公開する場合は `.env` で `BIND_HOST=0.0.0.0` を設定してください。

### 4. Cloudflare Tunnel の設定

すでに Raspberry Pi に cloudflared がセットアップされている場合:

```bash
cloudflared tunnel route dns YOUR_TUNNEL_NAME ai-rotom-bridge
```

`config.yml` に追加:
```yaml
ingress:
  - hostname: ai-rotom-bridge.your-domain.com
    service: http://localhost:3210
  - service: http_status:404
```

Workers の環境変数 `PI_BRIDGE_URL` を Tunnel のホスト名に設定:
```bash
npx wrangler secret put PI_BRIDGE_URL
# → https://ai-rotom-bridge.your-domain.com
```

### 5. 環境変数の設定

#### Worker (Cloudflare)

```bash
# 必須
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_APPLICATION_ID
npx wrangler secret put DISCORD_TOKEN
npx wrangler secret put PI_BRIDGE_URL
npx wrangler secret put CF_ACCESS_CLIENT_ID
npx wrangler secret put CF_ACCESS_CLIENT_SECRET

# 任意（チャンネル制限）
npx wrangler secret put ALLOWED_CHANNEL_IDS
# → "123456789012345678,987654321098765432"
```

#### Raspberry Pi (`.env`)

| 変数 | 説明 | デフォルト |
|---|---|---|
| `PORT` | サーバーポート | `3210` |
| `BIND_HOST` | バインドアドレス | `127.0.0.1` |
| `DATABASE_PATH` | SQLite ファイルパス | `/tmp/rotom-conversations.db` |
| `OPENCODE_GO_API_KEY` | OpenCode Go API キー | **(必須)** |
| `OPENCODE_GO_BASE_URL` | API ベース URL | `https://opencode.ai/zen/go/v1` |
| `BRIDGE_URL` | ツール実行用内部 URL | `http://127.0.0.1:3210` |

### 6. 動作確認

Discord で Bot がいるサーバーのチャンネルに移動し:

```
/ask message: カバルドンの対策候補を教えて
```

会話をリセット:
```
/reset
```

Pi の単体テスト:
```bash
curl http://localhost:3210/health
curl -X POST http://localhost:3210/ask \
  -H "Content-Type: application/json" \
  -d '{"userMessage":"ゲンガーの弱点は？","channelId":"test","applicationId":"dummy","interactionToken":"dummy"}'
```

## コマンド一覧

| コマンド | 説明 |
|---|---|
| `/ask message: <質問>` | ポケモン対戦について質問する。チャンネルごとに会話が継続します |
| `/reset` | 現在のチャンネルの会話履歴をリセット |

## 会話セッション

- 各チャンネルごとに独立した会話セッションが SQLite で管理されます
- 30分間操作がないとセッションは自動クリアされます
- `/reset` で手動リセットも可能

## プロジェクト構成

```
ai-rotom-discord-remote/
├── worker/                    # Cloudflare Worker (軽量プロキシ)
│   ├── src/
│   │   ├── index.ts           # エントリポイント
│   │   ├── discord.ts         # Discord 署名検証・応答
│   │   ├── ai.ts              # [参考] AI ロジック（Pi に移植済み）
│   │   ├── tool-definitions.ts # [参考] ツール定義（Pi に移植済み）
│   │   ├── mcp-bridge.ts      # [参考] MCP ブリッジ通信（未使用）
│   │   ├── conversation-do.ts # [参考] DO 会話管理（Pi に移植済み）
│   │   └── types.ts           # 型定義
│   ├── wrangler.toml
│   └── package.json
└── rpi-bridge/                # Raspberry Pi サーバー
    ├── src/
    │   ├── index.ts           # HTTP サーバー + MCP Client (+ /ask /reset)
    │   ├── ai-service.ts      # AI 処理 (OpenCode Go API + ツール呼出ループ)
    │   ├── conversation-manager.ts # SQLite 会話セッション管理
    │   ├── discord-webhook.ts  # Discord Webhook 応答編集
    │   ├── tool-definitions.ts # ツール定義 (30種) + システムプロンプト
    │   ├── db.ts               # SQLite 初期化
    │   └── types.ts            # 型定義
    ├── .env.example
    ├── .npmrc
    └── package.json
```

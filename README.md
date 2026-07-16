# ai-rotom-discord-remote

Discord をインターフェースにして、スマホからでも [ai-rotom](https://github.com/nonz250/ai-rotom) (ポケモンチャンピオンズ対戦アドバイザー MCP サーバー) にアクセスできる Discord Bot。

## アーキテクチャ

```
Discord (スマホ/PC) → Cloudflare Workers → OpenCode Go API (AI判断)
                              │
                              ▼ (ツール呼び出し時)
                    Cloudflare Tunnel
                              │
                    Raspberry Pi (MCP Bridge)
                              │
                    ai-rotom MCP Server (stdio)
```

- **Cloudflare Workers**: Discord Bot の受信・AI 連携・会話セッション管理
- **Raspberry Pi**: ai-rotom を子プロセスで実行し、HTTP API として公開
- **Cloudflare Tunnel**: Workers ↔ Raspberry Pi 間のセキュアな接続

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
# .dev.vars を編集し実際の値を設定

npm install
npx wrangler deploy
```

デプロイ後、スラッシュコマンドを登録:

```bash
curl -X POST https://YOUR_WORKER.workers.dev/register
```

Interaction Endpoint URL を Discord Developer Portal に設定:
- URL: `https://YOUR_WORKER.workers.dev/interactions`
- General Information → INTERACTIONS ENDPOINT URL

### 3. Raspberry Pi 側の準備

```bash
# Node.js >= 24 が必要 (ai-rotom の要件)
cd rpi-bridge
npm install
npm start
```

デフォルトで `http://127.0.0.1:3210` で起動します。
公開する場合は `BIND_HOST=0.0.0.0` を設定してください。

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

Workers の環境変数 `MCP_BRIDGE_URL` を Tunnel のホスト名に設定:
```bash
npx wrangler secret put MCP_BRIDGE_URL
# → https://ai-rotom-bridge.your-domain.com
```

### 5. 環境変数の設定

Workers に以下の secret を設定:

```bash
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_APPLICATION_ID
npx wrangler secret put DISCORD_TOKEN
npx wrangler secret put OPENCODE_GO_API_KEY
npx wrangler secret put MCP_BRIDGE_URL
```

特定のチャンネルに制限する場合:
```bash
npx wrangler secret put ALLOWED_CHANNEL_IDS
# → "123456789012345678,987654321098765432"
```

### 6. 動作確認

Discord で Bot がいるサーバーのチャンネルに移動し:

```
/ask message: カバルドンの対策候補を教えて
```

会話をリセット:
```
/reset
```

## コマンド一覧

| コマンド | 説明 |
|---|---|
| `/ask message: <質問>` | ポケモン対戦について質問する。チャンネルごとに会話が継続します |
| `/reset` | 現在のチャンネルの会話履歴をリセット |

## 会話セッション

- 各チャンネルごとに独立した会話セッションが Durable Objects で管理されます
- 30分間操作がないとセッションは自動クリアされます
- `/reset` で手動リセットも可能

## プロジェクト構成

```
ai-rotom-discord-remote/
├── worker/               # Cloudflare Workers (Discord Bot + AI)
│   ├── src/
│   │   ├── index.ts           # エントリポイント
│   │   ├── discord.ts         # Discord 署名検証・応答
│   │   ├── ai.ts              # OpenCode Go API 呼び出し
│   │   ├── tool-definitions.ts # ツール定義 (30種)
│   │   ├── mcp-bridge.ts      # MCP ブリッジ通信
│   │   ├── conversation-do.ts # Durable Object (会話管理)
│   │   └── types.ts           # 型定義
│   ├── wrangler.jsonc
│   └── package.json
└── rpi-bridge/           # Raspberry Pi MCP ブリッジ
    ├── src/
    │   └── index.ts           # HTTPサーバー + MCP Client
    └── package.json
```

# ai-rotom-discord-remote

[ai-rotom](https://github.com/nonz250/ai-rotom)（ポケモンチャンピオンズ対戦アドバイザー MCP サーバー）に、**2つのインターフェース**からアクセスできるようにしたシステム。

| インターフェース | 用途 | 利用者 |
|---|---|---|
| **Discord Bot** (`/ask`, `/reset`) | スマホ・PC から手軽に質問 | Discord アカウントを持つ人 |
| **Web UI「AIバトルコーチ」** | 家庭内ブラウザからのチャット | 家族（子どもを含む） |

Web UI はユーザーごとに会話履歴・AI の性格・表示モードを持ち、子ども向け／高学年以上向けに UI と回答の難易度を切り替えられます（→ [Web UI「AIバトルコーチ」](#web-ui-aiバトルコーチ)）。

## アーキテクチャ（ハイブリッド構成）

```
Discord (スマホ/PC)                       ブラウザ (家庭内 LAN)
    ↓ (Interactions 受信)                      ↓ (HTTP)
Cloudflare Worker (軽量プロキシ)                │
    ├── Discord 署名検証                        │
    ├── deferredResponse() を返す (3秒以内)      │
    └── 非同期で Raspberry Pi に POST /ask       │
            ↓ (Cloudflare Tunnel + Access 認証) │
            ↓                          Caddy (:443, TLS 終端)
            ↓                                  ↓
Raspberry Pi (Node.js HTTP サーバー) ←──────────┘
    ├── Web UI 配信 (public/)
    ├── AI 処理実行 (OpenCode Go API)
    ├── セッション管理 (SQLite)
    ├── ツール呼び出しループ
    ├── MCP Bridge (ai-rotom stdio)
    └── Discord Webhook で応答編集
```

- **Cloudflare Worker**: Discord 受信 → 署名検証 → 即座に deferred response → Pi へ転送するだけの薄いプロキシ
- **Raspberry Pi**: AI 推論・ツール実行・セッション管理・Webhook 応答・Web UI 配信のすべてを担当
- **Cloudflare Tunnel + Access**: Worker ↔ Pi 間のセキュアな接続
- **Caddy**: 家庭内 LAN からの Web UI アクセスの TLS 終端（→ [Web UI の HTTPS 化](#5-web-ui-の-https-化推奨)）

Web UI は Pi が直接配信するため、Discord / Worker を経由しません。

### 旧構成との違い

| | 旧構成 | 新構成 |
|---|---|---|
| AI 処理 | Worker (Durable Object) | Raspberry Pi |
| セッション管理 | Durable Object (SQLite) | Raspberry Pi (SQLite) |
| ツール実行 | Worker → Tunnel → Pi | Pi 内でローカル実行 |
| Discord 応答 | Worker (Webhook PATCH) | Pi (Webhook PATCH) |
| デバッグ | wrangler tail のみ | VS Code リモートデバッグ可能 |

---

## Web UI「AIバトルコーチ」

ビルド不要の静的ファイル（HTML/CSS/JS）で、Pi が `public/` を直接配信します。

アクセス先は構成によって変わります。

| 構成 | URL |
|---|---|
| HTTPS 化あり（推奨） | `https://rotom.<家庭用ドメイン>/` |
| 素の状態 | `http://<Pi のアドレス>:3210/` |

保護者 PIN が平文で LAN 上を流れるため、[Web UI の HTTPS 化](#5-web-ui-の-https-化推奨)を推奨します。

### 表示モード

ユーザーごとに **キッズ**（小学校低学年想定）と **ジュニア**（高学年〜大人想定）を設定でき、**UI の語彙・文字サイズ・装飾だけでなく AI の回答スタイルも変わります**。

| | キッズ | ジュニア |
|---|---|---|
| アプリ名 | ロトム**ずかん** | ロトム**図鑑** |
| 語彙 | あたらしい おはなし／けす | 新しいチャット／削除 |
| 本文サイズ | 19px | 16px |
| 角丸・枠線 | 18px・2px（ぽってり） | 12px・1px（シャープ） |
| 履歴の行 | 2行折り返し・大きめ | 1行省略・高密度 |
| 待機表示 | ピカチュウのイラスト＋「ロトムが しらべているよ！」 | 回転するボール＋控えめな表示 |
| 質問例 | ひらがな中心 | 「カメックスのSP調整を教えて」など |
| **AI の回答** | ひらがな多め・短文・200文字程度まで | 漢字通常・種族値やSP調整など具体的な数値 |

回答スタイルの制御は、システムプロンプトへモード別の指示を**実行時に付与**することで実現しています（`conversation-manager.ts` の `MODE_INSTRUCTIONS`）。

### 主な機能

- **ユーザー切り替え** — アバター付きカードで選択。選択内容は `localStorage` に保存
- **セッション管理** — 作成・切り替え・名前変更・削除。名前は最初の発言から自動生成
- **Markdown 表示** — 表・リスト・コードブロックに対応。表は横スクロールして狭い画面でも崩れない
- **読み上げ** — Web Speech API（ja-JP）で回答を音読
- **アイコン変更** — 16種類のポケモンから選択
- **文字サイズ切り替え** — 標準／大きい（モードとは独立して上乗せ）
- **ダークモード** — 自動（OS 設定）／ライト／ダーク
- **モバイル対応** — サイドバーはドロワー化、`safe-area` 対応

### 保護者向け設定（PIN ロック）

ヘッダー右端の小さな歯車から、**4桁 PIN** を入力して開きます。

設定できる項目:
- ユーザーごとの表示モード（キッズ／ジュニア）
- ユーザーごとの AI の性格（システムプロンプト）
- ユーザーのアイコン変更・削除
- 外観（自動／ライト／ダーク）
- PIN の変更

**PIN は UI 上だけのロックではありません。** サーバー側で検証しており、初期 PIN は環境変数 `PARENT_PIN`（既定 `1234`）です。初回認証時に salt 付き scrypt ハッシュとして DB に保存されます。認証に成功すると 30 分間有効なトークンが発行され、保護者専用 API はこのトークンを必須とします。

#### 操作ごとの権限

| 操作 | PIN |
|---|---|
| アバター変更 | **不要**（見た目だけの設定なので子ども自身が変更できる） |
| 表示名の変更 | 必要 |
| 表示モードの変更 | 必要 |
| システムプロンプトの編集 | 必要 |
| ユーザーの削除 | 必要 |

> アバターを保護者のみに制限したい場合は、`src/index.ts` の PATCH ハンドラにある `needsParent` の判定条件を変更してください。

### システムプロンプトはユーザーごと

`system_prompts` テーブルは `user_id` が PRIMARY KEY で、**ユーザー個別に保存**されます。未設定のユーザーは全員共通のデフォルト（`tool-definitions.ts` の `getSystemPrompt()`）にフォールバックします。

AI に渡る最終的なプロンプトは次の構成です。

```
保存内容（ユーザー個別、未設定なら共通デフォルト）
  + モード指示（キッズ／ジュニア、ユーザー個別）
```

設定画面では「対象ユーザー」セレクタで誰の設定を編集するか選びます。編集途中の内容は対象を切り替えても保持され、保存時は**変更のあったユーザーだけ**が送信されます。

> **実装上の注意**: 編集用 API (`GET /api/users/:id/prompt`) は `getStoredSystemPrompt()` を返し、モード指示を**含みません**。実行用の `getSystemPromptForUser()` と混同すると、保存のたびにモード指示が本文へ焼き込まれて増殖します。

---

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

> Web UI だけを使う場合、この手順と手順 2・4 は不要です。

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

pnpm install
pnpm dev          # 通常起動
pnpm dev:inspect  # VS Code リモートデバッグ用 (port 9229)
```

デフォルトで `http://127.0.0.1:3210` で起動します。

家庭内の他の端末（タブレットなど）から Web UI を開く場合、`BIND_HOST` の扱いは構成によって変わります。

| 構成 | `BIND_HOST` |
|---|---|
| [HTTPS 化あり](#5-web-ui-の-https-化推奨)（推奨） | `127.0.0.1` のまま。Caddy が前段で受けるため LAN へ晒す必要がない |
| 素の状態 | `0.0.0.0`。平文の `:3210` が LAN から直接見える |

DB スキーマは起動時に自動マイグレーションされるため、既存の DB をそのまま使えます。

#### アバター画像の準備（Web UI を使う場合は必須）

Web UI のアバター画像は[ポケモンイラストラボ](https://www.pokemon.jp/special/illust-lab)の素材を使用しています。
**再配布不可のためリポジトリには含めていません。** 以下の手順で生成してください。

1. [ポケモンイラストラボ](https://www.pokemon.jp/special/illust-lab)から `pokemon_illust_lab_202403.zip` をダウンロード
2. リポジトリ直下か `~/Downloads` に置く（別の場所なら引数でパスを指定）
3. セットアップスクリプトを実行

```bash
./scripts/setup-pokemon-assets.sh
# 別の場所に置いた場合
./scripts/setup-pokemon-assets.sh ~/Desktop/pokemon_illust_lab_202403.zip
```

ZIP から必要な 18 点だけを取り出し、160px の PNG に縮小して
`rpi-bridge/public/img/avatars/` に配置します。

- 縮小には macOS の `sips`、Linux では ImageMagick（`sudo apt install imagemagick`）を使います
- ZIP 内の日本語ファイル名は文字コード（CP932 / UTF-8）と Unicode 正規化（NFC / NFD）の揺れを吸収して照合するため、Windows・macOS どちらで作られた ZIP でも動作します
- 素材の構成が変わって一部を取り出せなかった場合は、不足分を表示して異常終了します（スクリプト内の `MAPPINGS` を更新してください）

この画像を配置しなくてもアプリは起動しますが、アバターが表示されません。

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

> **注意**: Tunnel でこのホストを公開すると Web UI もインターネットから到達可能になります。Web UI 自体にログイン機能はないため、公開する場合は Cloudflare Access などで必ず前段に認証を置いてください。

### 5. Web UI の HTTPS 化（推奨）

家庭内 LAN から `https://rotom.<家庭用ドメイン>/` でアクセスできるようにします。ドメインを Cloudflare で管理していることが前提です。

- 証明書は Let's Encrypt を **DNS-01 チャレンジ**で取得するため、**Pi をインターネットへ公開する必要はありません**（80/443 の穴あけ不要）
- Pi 上の Caddy が TLS を終端し、`127.0.0.1:3210` の rpi-bridge へリバースプロキシします
- 証明書の取得と 90 日ごとの更新は Caddy が自動で行うため、cron の設定は不要です

```bash
cd deploy/caddy
cp .mise.toml.example .mise.toml
mkdir -p logs
# .mise.toml の [env] にドメインと Cloudflare API トークンを設定

mise trust
mise run up
```

**手順の詳細（API トークンの発行、DNS レコードの作成、トラブルシューティング）は [deploy/caddy/README.md](deploy/caddy/README.md) を参照してください。** 設計上の判断は [ADR-0002](docs/adr/ADR-0002.md) に記録しています。

HTTPS 化すると、保護者 PIN やトークンが LAN 上を平文で流れなくなり、Pi の IP 変更が家族に影響しなくなります。

> **注意**: これは通信路の保護であり、認証の追加ではありません。Web UI にログイン機能がない点は変わらないため、**インターネットへの公開は引き続き想定していません**。

### 6. 環境変数の設定

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
| `BIND_HOST` | バインドアドレス（Caddy 経由なら `127.0.0.1` のまま） | `127.0.0.1` |
| `DATABASE_PATH` | SQLite ファイルパス | `/tmp/rotom-conversations.db` |
| `OPENCODE_GO_API_KEY` | OpenCode Go API キー | **(必須)** |
| `OPENCODE_GO_BASE_URL` | API ベース URL | `https://opencode.ai/zen/go/v1` |
| `BRIDGE_URL` | ツール実行用内部 URL | `http://127.0.0.1:3210` |
| `PARENT_PIN` | Web UI 保護者設定の初期 PIN（数字4桁） | `1234` |
| `WEB_SESSION_TTL_DAYS` | Web チャット履歴の保持日数（Discord は 30分固定） | `30` |

### 7. 動作確認

#### Discord

```
/ask message: カバルドンの対策候補を教えて
/reset
```

#### Web UI

ブラウザで `https://rotom.<家庭用ドメイン>/`（HTTPS 化していない場合は `http://<Pi のアドレス>:3210/`）を開きます。初回起動時はユーザーが存在しないため「ゲスト」が自動作成されます。歯車 → PIN（既定 `1234`）から家族のユーザーを追加し、それぞれのモードとアイコンを設定してください。

#### Pi の単体テスト

```bash
curl http://localhost:3210/health

curl -X POST http://localhost:3210/ask \
  -H "Content-Type: application/json" \
  -d '{"userMessage":"ゲンガーの弱点は？","channelId":"test","applicationId":"dummy","interactionToken":"dummy"}'
```

---

## API エンドポイント

「保護者認証」列が ✅ の場合、`X-Parent-Token` ヘッダーが必要です。

| メソッド | パス | 説明 | 保護者認証 |
|---|---|---|---|
| GET | `/` | Web UI |  |
| GET | `/health` | ヘルスチェック |  |
| GET | `/tools` | MCP ツール一覧 |  |
| POST | `/tools/:name` | MCP ツール実行 |  |
| POST | `/ask` | Discord 用 AI 質問 |  |
| POST | `/reset` | Discord 用会話リセット |  |
| GET | `/api/users` | ユーザー一覧 |  |
| POST | `/api/users` | ユーザー作成 |  |
| PATCH | `/api/users/:id` | ユーザー更新 | 名前・モードのみ ✅ |
| DELETE | `/api/users/:id` | ユーザー削除（履歴ごと） | ✅ |
| GET | `/api/users/:id/prompt` | プロンプト取得（編集用） |  |
| PUT | `/api/users/:id/prompt` | プロンプト更新 | ✅ |
| GET | `/api/parent/status` | PIN 設定状況 |  |
| POST | `/api/parent/verify` | PIN 認証・トークン発行 |  |
| PUT | `/api/parent/pin` | PIN 変更 | ✅ |
| POST | `/api/web/ask` | Web 用 AI 質問 |  |
| POST | `/api/web/reset` | Web 用会話リセット |  |
| GET | `/api/sessions?user_id=` | セッション一覧 |  |
| GET | `/api/sessions/:id` | メッセージ履歴 |  |
| PUT | `/api/sessions/:id` | セッション名変更 |  |
| DELETE | `/api/sessions/:id?user_id=` | セッション削除 |  |

セッション削除は `user_id` を必ず条件に含めるため、他ユーザーのセッションは削除できません（404 を返します）。

## データベース構成

SQLite。起動時に自動でテーブル作成・マイグレーションが行われます。

| テーブル | 主なカラム | 用途 |
|---|---|---|
| `conversations` | `session_id`(PK), `user_id`, `session_name`, `expires_at` | 会話セッション（Discord / Web 共用） |
| `messages` | `session_id`(FK), `role`, `content` | メッセージ履歴 |
| `users` | `user_id`(PK), `display_name`, `avatar`, `mode` | Web UI のユーザー |
| `system_prompts` | `user_id`(PK), `prompt_text` | ユーザー個別のシステムプロンプト |
| `app_settings` | `key`(PK), `value` | 保護者 PIN（`salt:scryptハッシュ`）など |

セッション ID の形式:
- Discord: `channel:{channelId}`
- Web: `user:{userId}:session:{uuid}`

## 会話セッション

Discord はチャンネルごと、Web はユーザーごとに独立したセッションを持ち、**保持期間はそれぞれ異なります**。

| | 保持期間 | 理由 |
|---|---|---|
| Discord (`channel:{id}`) | **30分** | チャンネルは不特定多数が使うため短時間で文脈を切る |
| Web (`user:{id}:session:{uuid}`) | **30日**（既定・変更可） | 家族が後日「前の会話の続き」をたどれるようにする |

- 期限はアクセスのたびに延長されるため、実質「**最後に使ってから N 日**」です
- 期限切れセッションは 10 分ごとのクリーンアップで削除されます（メッセージも FK の CASCADE で消えます）
- `/reset` またはセッションの「削除」で手動削除も可能
- Web の保持日数は `.env` の `WEB_SESSION_TTL_DAYS` で変更できます（不正値・0以下を指定した場合は警告を出して既定の 30 日にフォールバック）

TTL を延ばした後の初回起動時、旧仕様（30分）で作られた Web セッションの期限は自動で新しい保持期間へ引き延ばされます（`db.ts` の `extendWebSessionExpiry()`）。この移行がないと、設定変更直後に既存の履歴がまとめて削除されてしまいます。

> なお、AI に送る履歴は **user / assistant のやり取り直近 20 件**に絞られます（`MAX_CONVERSATION_MESSAGES`）。ツールの呼び出し記録はこの数に含めず、過去ターン分は落とします。過去に調べた数値は回答本文に残っているためです。画面には全履歴が表示されます。
>
> 以前は role を問わず 20 件だったため、ツールを 8 回呼ぶだけで枠が埋まり、実質 1〜2 往復しか記憶が残りませんでした（→ [ADR-0006](docs/adr/ADR-0006.md)）。

## Discord コマンド一覧

| コマンド | 説明 |
|---|---|
| `/ask message: <質問>` | ポケモン対戦について質問する。チャンネルごとに会話が継続します |
| `/reset` | 現在のチャンネルの会話履歴をリセット |

## プロジェクト構成

```
ai-rotom-discord-remote/
├── worker/                        # Cloudflare Worker (軽量プロキシ)
│   ├── src/
│   │   ├── index.ts               # エントリポイント
│   │   ├── discord.ts             # Discord 署名検証・応答
│   │   ├── ai.ts                  # [参考] AI ロジック（Pi に移植済み）
│   │   ├── tool-definitions.ts    # [参考] ツール定義（Pi に移植済み）
│   │   ├── mcp-bridge.ts          # [参考] MCP ブリッジ通信（未使用）
│   │   ├── conversation-do.ts     # [参考] DO 会話管理（Pi に移植済み）
│   │   └── types.ts               # 型定義
│   ├── wrangler.toml
│   └── package.json
├── rpi-bridge/                    # Raspberry Pi サーバー
│   ├── src/
│   │   ├── index.ts               # HTTP サーバー + MCP Client + 全 API ルート
│   │   ├── ai-service.ts          # AI 処理 (OpenCode Go API + ツール呼出ループ)
│   │   ├── conversation-manager.ts # セッション/ユーザー/プロンプト/PIN 管理
│   │   ├── discord-webhook.ts     # Discord Webhook 応答編集
│   │   ├── tool-definitions.ts    # ツール定義 (30種) + 既定システムプロンプト
│   │   ├── tool-result-formatter.ts # ツール結果の整形（巨大な出力を要点へ圧縮）
│   │   ├── db.ts                  # SQLite 初期化・マイグレーション
│   │   └── types.ts               # 型定義
│   ├── public/                    # Web UI（ビルド不要の静的ファイル）
│   │   ├── index.html
│   │   ├── style.css              # モード切替を含む全スタイル
│   │   ├── app.js                 # UI ロジック・API 通信
│   │   ├── marked.js              # Markdown パーサ
│   │   └── img/                   # ※ Git 管理対象外（スクリプトで生成）
│   │       ├── avatars/           # 160px PNG 18枚（選択可能16種 + ball/pikachu-dance）
│   │       └── pokemon_illust_lab_202403/  # ZIP の展開物（任意）
│   ├── .env.example
│   └── package.json
├── deploy/
│   └── caddy/                     # Web UI の TLS 終端（Let's Encrypt / DNS-01）
│       ├── Dockerfile             # Cloudflare DNS モジュール入り Caddy のビルド
│       ├── docker-compose.yml
│       ├── Caddyfile
│       ├── .mise.toml.example     # 環境変数と操作タスク（コピーして使う）
│       └── README.md              # 手順書・トラブルシューティング
├── scripts/
│   ├── setup-pokemon-assets.sh    # イラストラボ素材の展開・リサイズ
│   └── start-opencode-web.sh
└── docs/
    └── adr/                       # Architecture Decision Records
        ├── ADR-0001.md            # 家庭用 Web チャットアプリの設計判断
        └── ADR-0002.md            # Web UI の TLS 終端と証明書取得方式
```

## セキュリティ上の注意

- **Web UI にログイン機能はありません。** ユーザー選択は「誰として使うか」を選ぶだけで、認証ではありません。家庭内 LAN での利用を前提としています
- 保護者設定の PIN はサーバー側で検証されますが、これは**子どもの誤操作を防ぐためのもの**であり、本格的なアクセス制御ではありません
- PIN と保護者トークンを LAN 上に平文で流さないため、[Web UI の HTTPS 化](#5-web-ui-の-https-化推奨)を推奨します（家庭内の Wi-Fi にはゲストや子どもの端末も接続します）
- インターネットに公開する場合は、Cloudflare Access など前段の認証を必ず併用してください
- AI の応答は Markdown として描画されますが、変換前に `<` `>` をエスケープしているため、応答やツール結果に含まれる生 HTML は実行されません

## 素材のライセンス

Web UI のアバター画像は [ポケモンイラストラボ](https://www.pokemon.jp/special/illust-lab)（教育・保育目的の素材提供サービス）の素材を使用しています。

- © 2022 Pokémon. © 1995-2022 Nintendo/Creatures Inc./GAME FREAK inc.
- ポケットモンスター・ポケモン・Pokémon は任天堂・クリーチャーズ・ゲームフリークの登録商標です

本リポジトリは**家庭内での私的利用**を前提としています。外部へ公開・配布する場合は、必ず[利用規約](https://www.pokemon.jp/special/illust-lab)を再確認してください。

**素材は再配布不可のため Git 管理対象外**とし、`scripts/setup-pokemon-assets.sh` で各自が生成する方式にしています。`.gitignore` で以下を除外しています。

```
pokemon_illust_lab_*.zip                    # ダウンロードした ZIP
rpi-bridge/public/img/pokemon_illust_lab_*/ # その展開物
rpi-bridge/public/img/avatars/              # 生成したアバター画像
docs/ui-mock/                               # UI 検討用モック（実装に置き換わったため）
```

## 関連ドキュメント

- [ADR-0001](docs/adr/ADR-0001.md) — 家庭用 Web チャットアプリケーションの設計判断
- [ADR-0002](docs/adr/ADR-0002.md) — Web UI の TLS 終端と証明書取得方式
- [deploy/caddy/README.md](deploy/caddy/README.md) — HTTPS 化の手順書
- [AGENTS.md](AGENTS.md) — 開発時の注意点・コマンド・既知の重複コード

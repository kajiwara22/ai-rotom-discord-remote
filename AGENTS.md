# AGENTS.md

## プロジェクト概要

Discord スラッシュコマンド (`/ask`, `/reset`) を受け付け、Cloudflare Worker 経由で Raspberry Pi 上の AI 処理サーバーに転送するハイブリッド Bot。AI プロバイダは OpenCode Go API (`deepseek-v4-pro` モデル)。Raspberry Pi 側で `@nonz250/ai-rotom` MCP サーバーに stdio 接続し、ポケモンチャンピオンズ対戦ツールを実行する。

## モノレポ構成（非ワークスペース）

パッケージは独立した2ディレクトリ。共有コードはなく、一部ファイル（ツール定義、型定義）は**重複コピー**されている。

| ディレクトリ | 役割 | 実行環境 |
|---|---|---|
| `worker/` | Discord Interactions 受信・署名検証・Pi への転送プロキシ | Cloudflare Workers |
| `rpi-bridge/` | AI 処理・MCP 接続・SQLite 会話管理 | Raspberry Pi (Node.js + tsx) |

## コマンド

### worker/
```bash
npm run dev        # wrangler dev
npm run deploy     # wrangler deploy
npm run typecheck  # tsc --noEmit
```

### rpi-bridge/
```bash
npm run dev         # node --import tsx --watch src/index.ts
npm start           # node --import tsx src/index.ts
npm run dev:inspect # node --inspect=0.0.0.0:9229 --import tsx src/index.ts
```

**rpi-bridge に `typecheck` スクリプトは定義されていない**。手動で `npx tsc --noEmit` を実行する（workdir: `rpi-bridge/`）。

## 注意すべき重複・デッドコード

- **`rpi-bridge/src/tool-definitions.ts`** が**現在アクティブなツール定義**。`worker/src/tool-definitions.ts` は旧構成の参考実装で**使用されていない**。ツールを追加/変更する場合は rpi-bridge 側のみ編集すればよい。
- **`worker/src/ai.ts`**, **`worker/src/conversation-do.ts`**, **`worker/src/mcp-bridge.ts`** も同様に旧構成の遺産。AI ロジックは `rpi-bridge/src/ai-service.ts` に実装されている。
- `worker/src/types.ts` と `rpi-bridge/src/types.ts` は別物（rpi-bridge 側は Discord 型 + `AskRequest`/`AskResponse` を含む）。

## wrangler.toml の注意点

`worker/wrangler.toml` には Durable Object の**削除マイグレーション**が定義されている:
```toml
[[migrations]]
tag = "v2"
deleted_classes = ["ConversationSession"]
```
この migraton タグを削除したり変更しないこと（既存 DO データの整合性が壊れる可能性がある）。

## 環境変数

### worker/ (.dev.vars.example)
BOT トークンや CF-Access 認証情報を含む。本番では `wrangler secret put` で設定する想定。

### rpi-bridge/ (.env.example)
- `OPENCODE_GO_API_KEY`, `OPENCODE_GO_BASE_URL` — OpenCode Go API の認証情報
- `DATABASE_PATH` — デフォルト `/tmp/rotom-conversations.db`
- `BRIDGE_URL` — MCP Bridge 自身の URL（ツール外部公開用）

## アーキテクチャ上の制約

- **Worker は 3 秒以内に応答必須**（Discord の制約）のため、`deferredResponse()` で即応答し、Pi への転送は `ctx.waitUntil()` で非同期実行する。
- **Worker → Pi 間は Cloudflare Tunnel + Access 認証**で保護されている（`CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`）。
- **Pi 側の AI 処理完了後、Webhook PATCH で直接 Discord の元応答を編集する**（Worker を経由しない）。
- **セッションはチャンネル単位**（`channel:{channelId}`）。TTL 30分、最大20メッセージ。
- **ツール呼び出しループは最大30回**。
- **ツール結果は `tool-result-formatter.ts` で整形してから LLM に渡す**（[ADR-0006](docs/adr/ADR-0006.md)）。ai-rotom の分析系ツールは出力が巨大で、`find_counters` は実測 5.7MB に達する。ツール名ごとの整形関数で「判断に効く順」へ並べ替えてから上位を残す。**先頭からの一律切り詰めを再び入れないこと**（JSON を構造の途中で壊し、並び順の意味も失われる）。整形関数を持たないツールは 5000 文字まで素通しする。
- **ツールを追加したら整形の要否を確認する**。実出力サイズを計測してから判断すること。
- **パーティ系ツールは利用者ごとの名前空間を通す**（[ADR-0009](docs/adr/ADR-0009.md)）。上流はパーティを `~/.ai-rotom/parties.json` の単一ファイルに保存し、保存先を変える手段がない（パスは `os.homedir()` 固定）。`party-namespace.ts` が呼び出し時にパーティ名へ `user:{userId}/` または `discord/` を前置し、結果から外す。**接頭辞は内部表現であり、AI や利用者に見せる場面では必ず外すこと**。
- **打ち切り時は無言で終わらせない**。ツール上限に到達した場合と Discord の締切に達した場合は、`tools` を渡さずにもう一度生成し、そこまでに集めた情報で回答をまとめさせる（`finalizeWithoutTools()`）。生成にも失敗したときだけ固定文言を返す。
- **`finish_reason: "length"` は打ち切って明示する**。出力が `max_tokens` (4096) に達した場合、ツール呼び出しが混ざっていても引数が壊れている可能性があるため実行せず、途切れた旨の注記を付けて返す。
- **Discord は 12 分でツール呼び出しを打ち切る**。interaction token の失効（15分）までに応答手段が失われるのを防ぐため、3分のマージンを引いた締切を `runAsk()` で設定している。Web 側に締切はない。
- **外部通信にはタイムアウトがある**。OpenCode Go API は 120 秒、MCP ツール実行は 60 秒（`AbortSignal.timeout`）。ツール実行の失敗は例外にせず、失敗内容を文字列で AI に返してループを継続する。
- **Discord メッセージは1900文字で分割**（改行境界）、初回 PATCH、以降 POST で追加送信。
- **`POST /api/web/ask` は Accept ヘッダーで SSE と JSON を切り替える**（[ADR-0008](docs/adr/ADR-0008.md)）。`text/event-stream` を含む場合のみ SSE。Discord は interaction の仕組み上 SSE を使えないため、経路ごとに方式が違う点を前提に置くこと。
- **SSE の切断検知は `res.on("close")` を使う**。`req` の `"close"` はボディを読み終えた時点で発火済みのため、後から登録しても効かない。切断を検知しても**処理は止めない**（未完のツール往復を残さないため）。
- **進捗は種別（`kind`）と対象名だけを送り、文言はクライアントが組み立てる**。ツール名を画面に出さないため。ツールを追加したら `tool-progress.ts` の分類と `app.js` の語彙テーブル（`L.kids` / `L.junior` の `progress`）を確認すること。
- **Caddy 経由では SSE を圧縮対象から外す**必要がある（`deploy/caddy/Caddyfile` の `encode` の `match`）。圧縮を挟むとイベントがバッファに溜まる。
- **Web API のフィールドは snake_case**。内部の camelCase は API 境界で変換する（`index.ts` の `toWebAskResponse()`）。`types.ts` の `WebAskResponse` を実際に使って型で守ること。

## rpi-bridge: better-sqlite3

`better-sqlite3` はネイティブコンパイルが必要。`.npmrc` に `onlyBuiltDependencies[]=better-sqlite3` が設定されている。`npm install` 時にビルドツール (python3, make, gcc) が必要。

## rpi-bridge: tsx による直接実行

`node --import tsx src/index.ts` で TypeScript を直接実行。ビルドステップは不要。`tsx` が on-the-fly でトランスパイルする。

## テスト

テストは存在しない。型チェック (`tsc --noEmit`) のみが検証手段。

## ADR (Architecture Decision Records)

技術選定の理由は ADR に記録する。テンプレートは `docs/adr/README.md`、配置場所は `docs/adr/`。

- **フォーマット**: SCQA（Situation, Complication, Question, Answer）+ 決定・影響
- **ファイル名**: `docs/adr/ADR-XXXX.md`（0001 からの連番）
- **ステータス**: 検討中 / 採用 / 見送り / 差し替え済み
- **原則**: 完璧さより軽量性を優先。結論が固まっていなくても書き始める。未確定箇所は「TBD」でよい。
- **差し替え**: 一度採用した決定が覆る場合は、既存 ADR を書き換えず新 ADR を作成し、旧 ADR のステータスを「差し替え済み」に変更して相互リンクする。
- **一覧管理**: 一覧ファイルは持たず、`docs/adr/` のディレクトリ一覧を正とする。各 ADR ファイルのタイトルとステータスで内容が自己記述されるため、別途のインデックス管理は不要。

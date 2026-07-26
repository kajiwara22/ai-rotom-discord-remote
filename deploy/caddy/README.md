# Web UI の HTTPS 化（Caddy + Let's Encrypt / DNS-01）

家庭内 LAN から `https://rotom.home.example.com/` のように、**ブラウザに正規に信頼される証明書**で Web UI へアクセスするための構成です。

```
ブラウザ (家庭内 LAN)
    ↓ https://rotom.home.example.com  →  DNS が Pi の LAN IP を返す
Raspberry Pi
    ├── Caddy (:443)  ← Let's Encrypt 証明書を DNS-01 で自動取得・自動更新
    └── rpi-bridge (127.0.0.1:3210)
```

**Pi をインターネットへ公開する必要はありません。** Let's Encrypt の DNS-01 チャレンジは Cloudflare の DNS に TXT レコードを立てて所有証明を行うため、80/443 をルーターで開ける必要がありません。

決定の経緯と他の選択肢との比較は [ADR-0002](../../docs/adr/ADR-0002.md) を参照してください。

## 前提

- ドメインを Cloudflare で管理していること（ネームサーバーが Cloudflare を向いている）
- Raspberry Pi に Docker と Docker Compose プラグインが入っていること
- Pi の LAN IP が固定されていること（DHCP 予約か静的割り当て）
- [mise](https://mise.jdx.dev/) が入っていること（環境変数と操作タスクの管理に使う。なくても動く → [mise を使わない場合](#mise-を使わない場合)）

## 手順

### 1. Cloudflare API トークンを発行する

[ダッシュボード → My Profile → API Tokens](https://dash.cloudflare.com/profile/api-tokens) → **Create Token** → **Create Custom Token**。

| 項目 | 設定 |
|---|---|
| Permissions | `Zone` / `DNS` / **Edit** |
| Zone Resources | `Include` / `Specific zone` / **該当ドメインのみ** |

これ以外の権限は付けません。DNS の TXT レコードを立てられれば十分です。

> **Global API Key は使わないでください。** アカウント全体を操作できるため、漏れたときの影響が桁違いです。上記のトークンなら、最悪でも当該ゾーンの DNS レコードしか触られません。

生成されたトークンは一度しか表示されないので、この時点で控えておきます。

### 2. DNS レコードを作る

Cloudflare のダッシュボードで、Pi の LAN IP を指す A レコードを追加します。

| Type | Name | IPv4 address | Proxy status | TTL |
|---|---|---|---|---|
| A | `rotom.home` | `192.168.1.50`（Pi の LAN IP） | **DNS only（グレー）** | Auto |

- **Proxy status は必ず「DNS only」にします。** オレンジクラウド（プロキシ有効）のままではプライベート IP を登録できません。
- 家庭内サービスをまとめて Pi に向けたい場合は、Name を `*.home` にしてワイルドカードで登録しても構いません。

`_acme-challenge` の TXT レコードは Caddy が自動で作成・削除するので、手で用意する必要はありません。

### 3. 設定ファイルを用意する

```bash
cd deploy/caddy
cp .mise.toml.example .mise.toml
mkdir -p logs
```

`.mise.toml` の `[env]` を自分のドメインに合わせて編集します。

```toml
[env]
BASE_DOMAIN = "home.example.com"
ROTOM_HOST = "rotom.home.example.com"
ACME_EMAIL = "you@example.com"
CF_API_TOKEN = "（手順 1 で発行したトークン）"
```

`docker-compose.yml` はこれらをシェルの環境変数として受け取ります。mise がこのディレクトリで有効になっていれば、そのまま `docker compose` に渡ります。

初回は mise の信頼設定が必要です。

```bash
mise trust
mise env   # 4 つの変数が export されていれば OK
```

**`.mise.toml` は API トークンを含むため `.gitignore` 済みです。コミットしないでください。**

### 4. 起動する

```bash
mise run up
```

初回は Cloudflare DNS モジュール入りの Caddy をビルドするため、Raspberry Pi 上では数分かかります。

証明書の取得状況はログで確認できます。

```bash
mise run logs
```

用意してあるタスクは次のとおりです（`mise tasks` で一覧できます）。

| タスク | 内容 |
|---|---|
| `mise run up` | 起動（初回はビルド） |
| `mise run down` | 停止 |
| `mise run logs` | ログを追う |
| `mise run reload` | `Caddyfile` の変更を無停止で反映 |
| `mise run cert` | 配信中の証明書の有効期限を確認 |

`certificate obtained successfully` が出れば成功です。以降の更新（90 日ごと）は Caddy が自動で行うため、cron などの設定は不要です。

### 5. 動作を確認する

```bash
curl -v https://rotom.home.example.com/health
```

証明書エラーが出ずに `200` が返れば完了です。家庭内の PC・タブレットからブラウザで開き、鍵マークが表示されることも確認してください。

### 6. rpi-bridge を LAN から隠す

Caddy が前段に立つので、rpi-bridge は localhost だけを待ち受ければ十分です。`rpi-bridge/.mise.toml`（または `.env`）の値を次に戻します。

```toml
BIND_HOST = "127.0.0.1"
```

これで平文の `:3210` が LAN から見えなくなり、家庭内の通信もすべて TLS を通ります。Cloudflare Tunnel（`cloudflared`）も `http://localhost:3210` を見ているため、この変更の影響を受けません。

## mise を使わない場合

`docker-compose.yml` はシェルの環境変数を参照しているだけなので、mise は必須ではありません。同じ 4 つの変数を渡せれば何でも動きます。

このディレクトリに `.env` を置く方法が最も簡単です（compose が自動で読み込みます）。

```bash
cat > .env <<'EOF'
BASE_DOMAIN=home.example.com
ROTOM_HOST=rotom.home.example.com
ACME_EMAIL=you@example.com
CF_API_TOKEN=（手順 1 で発行したトークン）
EOF

docker compose up -d --build
```

`.env` も `.gitignore` 済みです。なお **シェルの環境変数のほうが `.env` より優先される**ため、mise が有効なディレクトリで `.env` を併用すると mise の値が勝ちます。混乱を避けるため、どちらか一方に統一してください。

## トラブルシューティング

### 名前が引けない / ブラウザが繋がらない

ルーターや Pi-hole の **DNS リバインディング保護**に弾かれている可能性があります。パブリック DNS がプライベート IP を返す構成のため、これをブロックする実装があります（dnsmasq の `stop-dns-rebind` など）。

まず切り分けます。

```bash
# パブリックリゾルバに直接聞く（ここで LAN IP が返れば Cloudflare 側は正しい）
dig +short rotom.home.example.com @1.1.1.1

# 普段使っているリゾルバ（ルーター）に聞く
dig +short rotom.home.example.com
```

前者だけ返るならリバインド保護です。ルーターの設定で当該ドメインを例外に加えるか、ローカル DNS 側で解決させてください。

### 起動時に「未設定です」と言われる

`docker-compose.yml` が環境変数を受け取れていません。

```bash
mise env | grep -E "BASE_DOMAIN|ROTOM_HOST|ACME_EMAIL|CF_API_TOKEN"
```

何も出ない場合は、次を確認します。

- `mise trust` を実行したか（未実行だと mise は設定を読み込みません）
- `deploy/caddy` ディレクトリで実行しているか（mise の `[env]` はディレクトリに紐づきます）
- `.mise.toml` の変数が `[env]` セクションの下にあるか（トップレベルに書くと読み込まれません）

### 証明書の取得に失敗する

ログに出る ACME のエラーを確認します。

```bash
docker compose logs caddy | grep -i -E "acme|error"
```

よくある原因:

- **トークンの権限不足** — `Zone:DNS:Edit` と対象ゾーンの指定を見直します
- **ネームサーバーが Cloudflare を向いていない** — `dig NS home.example.com` で確認します
- **試行を繰り返して締め出された** — Let's Encrypt は失敗にもレート制限があります。`Caddyfile` の `acme_ca` のコメントを外してステージング環境で設定を詰め、成功してから本番に戻してください（戻す際は `docker compose down` → `docker volume rm caddy_caddy_data` でステージングの証明書を捨てます）

### 80/443 が使えない

```bash
sudo ss -lntp | grep -E ':(80|443)'
```

他のサービスが掴んでいれば停止するか、そちらのポートを変更します。

### 証明書の状態を見る

```bash
mise run cert   # 有効期限と subject
docker compose exec caddy ls -R /data/caddy/certificates
```

## 運用上の注意

- **`caddy_data` ボリュームは消さないでください。** 証明書と ACME アカウント鍵が入っています。消すと再取得になり、Let's Encrypt のレート制限（同一登録ドメイン 週 50 枚）に近づきます。
- **HSTS の `max-age` は 1 時間に設定してあります。** 構成が安定してから伸ばしてください（一般的には `31536000`）。長い値を設定すると、その期間ブラウザ側で HTTP へ戻せなくなります。
- **ホスト名を増やすとき**は、A レコードを足して `Caddyfile` に `handle` ブロックを追加するだけです。ワイルドカード証明書がすでにあるため、証明書の取得は発生しません。
- **Pi の再起動時**はコンテナが自動で復帰します（`restart: unless-stopped`）。環境変数はコンテナ作成時に焼き込まれているため、mise が有効なシェルがなくても起動します。ただし `docker compose up` を再実行する際は、必ず `deploy/caddy` ディレクトリ（= mise が効く場所）から実行してください。cron や systemd から起動する場合は、`mise exec -- docker compose up -d` の形にするか、環境変数を明示的に渡す必要があります。

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
cp .env.example .env
mkdir -p logs
```

`.env` を自分のドメインに合わせて編集します。

```bash
BASE_DOMAIN=home.example.com
ROTOM_HOST=rotom.home.example.com
ACME_EMAIL=you@example.com
CF_API_TOKEN=（手順 1 で発行したトークン）
```

`.env` は `.gitignore` 済みです。コミットしないでください。

### 4. 起動する

```bash
docker compose up -d --build
```

初回は Cloudflare DNS モジュール入りの Caddy をビルドするため、Raspberry Pi 上では数分かかります。

証明書の取得状況はログで確認できます。

```bash
docker compose logs -f caddy
```

`certificate obtained successfully` が出れば成功です。以降の更新（90 日ごと）は Caddy が自動で行うため、cron などの設定は不要です。

### 5. 動作を確認する

```bash
curl -v https://rotom.home.example.com/health
```

証明書エラーが出ずに `200` が返れば完了です。家庭内の PC・タブレットからブラウザで開き、鍵マークが表示されることも確認してください。

### 6. rpi-bridge を LAN から隠す

Caddy が前段に立つので、rpi-bridge は localhost だけを待ち受ければ十分です。`rpi-bridge/.env` を次に戻します。

```bash
BIND_HOST=127.0.0.1
```

これで平文の `:3210` が LAN から見えなくなり、家庭内の通信もすべて TLS を通ります。Cloudflare Tunnel（`cloudflared`）も `http://localhost:3210` を見ているため、この変更の影響を受けません。

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
docker compose exec caddy ls -R /data/caddy/certificates
echo | openssl s_client -connect rotom.home.example.com:443 2>/dev/null | openssl x509 -noout -dates -subject
```

## 運用上の注意

- **`caddy_data` ボリュームは消さないでください。** 証明書と ACME アカウント鍵が入っています。消すと再取得になり、Let's Encrypt のレート制限（同一登録ドメイン 週 50 枚）に近づきます。
- **HSTS の `max-age` は 1 時間に設定してあります。** 構成が安定してから伸ばしてください（一般的には `31536000`）。長い値を設定すると、その期間ブラウザ側で HTTP へ戻せなくなります。
- **ホスト名を増やすとき**は、A レコードを足して `Caddyfile` に `handle` ブロックを追加するだけです。ワイルドカード証明書がすでにあるため、証明書の取得は発生しません。

# Cloudflare DNS モジュール入りの Caddy をビルドする。
#
# 公式の caddy イメージには DNS プロバイダのモジュールが同梱されていないため、
# DNS-01 チャレンジを使うには xcaddy でビルドし直す必要がある。
# （caddy:2-builder は、そのための公式ビルダーイメージ）
#
# Raspberry Pi 上での初回ビルドは Go のコンパイルが走るため数分かかる。
FROM caddy:2-builder AS builder

RUN xcaddy build \
    --with github.com/caddy-dns/cloudflare

FROM caddy:2

COPY --from=builder /usr/bin/caddy /usr/bin/caddy

#!/usr/bin/env bash
#
# ai-rotom のローカルビルドを再現する（ADR-0027）。
#
# 上流 nonz250/ai-rotom の特定コミットに patches/ai-rotom/*.patch を適用し、
# pnpm でビルドして packages/mcp-server/dist/index.mjs を生成する。
# rpi-bridge はこの dist を AI_ROTOM_ARGS で直接起動する。
#
# 使い方:
#   mise exec -- ./scripts/setup-ai-rotom.sh
#   AI_ROTOM_DIR=/path/to/ai-rotom ./scripts/setup-ai-rotom.sh
#
# 上流に追従するときは BASE_REF を上げ、パッチを当て直して作り直す。
# 手順は patches/ai-rotom/README.md を参照。

set -euo pipefail

# 上流の基準。タグ名またはブランチ名を指定する（SHA は shallow fetch できない）。
# 1.3.5 = ローカルパッチの基準リリース（2026-10-27 時点）
BASE_REF="${AI_ROTOM_BASE_REF:-1.3.5}"
DEST="${AI_ROTOM_DIR:-$HOME/ai-rotom}"
REPO="${AI_ROTOM_REPO:-https://github.com/nonz250/ai-rotom.git}"
PATCH_DIR="$(cd "$(dirname "$0")/../patches/ai-rotom" && pwd)"

die() {
	echo "エラー: $*" >&2
	exit 1
}

for cmd in git node pnpm; do
	command -v "$cmd" >/dev/null || die "$cmd が見つかりません（mise exec -- で実行してください）"
done

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 24 ] || die "Node 24 以上が必要です（現在 $(node -v)）。mise exec -- で実行してください"

if [ -e "$DEST" ]; then
	die "$DEST が既に存在します。削除するか AI_ROTOM_DIR で別の場所を指定してください"
fi

echo "==> $REPO を取得 (base: $BASE_REF) -> $DEST"
git clone -q --depth 1 --branch "$BASE_REF" "$REPO" "$DEST"

echo "==> パッチを適用: $PATCH_DIR"
shopt -s nullglob
patches=("$PATCH_DIR"/*.patch)
[ "${#patches[@]}" -gt 0 ] || die "$PATCH_DIR に .patch がありません"
git -C "$DEST" \
	-c user.name="ai-rotom local" \
	-c user.email="local@localhost" \
	am "${patches[@]}"

echo "==> pnpm install"
(cd "$DEST" && pnpm install --frozen-lockfile)

echo "==> build"
(cd "$DEST" && pnpm build)

DIST="$DEST/packages/mcp-server/dist/index.mjs"
[ -f "$DIST" ] || die "ビルド成果物が見つかりません: $DIST"

echo
echo "完了: $DIST"
echo "rpi-bridge/.mise.local.toml の AI_ROTOM_ARGS がこのパスを指しているか確認してください。"

#!/bin/bash

# ポケモンイラストラボ素材のセットアップスクリプト
#
# ポケモンイラストラボ (https://www.pokemon.jp/special/illust-lab) から
# ダウンロードした pokemon_illust_lab_202403.zip を展開し、
# Web UI で使うアバター画像を生成する。
#
# 素材は再配布不可のため Git 管理対象外としている。
# クローン直後や素材更新時にこのスクリプトを実行すること。
#
# 使い方:
#   ./scripts/setup-pokemon-assets.sh [zipファイルのパス]
#
# 引数を省略した場合は以下の順に探索する:
#   ./pokemon_illust_lab_202403.zip
#   ~/Downloads/pokemon_illust_lab_202403.zip

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AVATAR_DIR="$REPO_ROOT/rpi-bridge/public/img/avatars"
MOCK_DIR="$REPO_ROOT/docs/ui-mock/img"
ZIP_NAME="pokemon_illust_lab_202403.zip"

# アバターの表示サイズは最大 58px。Retina を考慮して 160px に縮小する
AVATAR_SIZE=160

# --- ZIP の場所を決定 -------------------------------------------------------

if [ $# -ge 1 ]; then
    ZIP_PATH="$1"
else
    if [ -f "$REPO_ROOT/$ZIP_NAME" ]; then
        ZIP_PATH="$REPO_ROOT/$ZIP_NAME"
    elif [ -f "$HOME/Downloads/$ZIP_NAME" ]; then
        ZIP_PATH="$HOME/Downloads/$ZIP_NAME"
    else
        echo "エラー: $ZIP_NAME が見つかりません。" >&2
        echo "" >&2
        echo "ポケモンイラストラボから素材をダウンロードし、" >&2
        echo "リポジトリ直下か ~/Downloads に置くか、パスを引数で指定してください。" >&2
        echo "  https://www.pokemon.jp/special/illust-lab" >&2
        echo "" >&2
        echo "  例) ./scripts/setup-pokemon-assets.sh ~/Desktop/$ZIP_NAME" >&2
        exit 1
    fi
fi

if [ ! -f "$ZIP_PATH" ]; then
    echo "エラー: 指定されたファイルが存在しません: $ZIP_PATH" >&2
    exit 1
fi

# --- 依存コマンドの確認 -----------------------------------------------------

if ! command -v python3 >/dev/null 2>&1; then
    echo "エラー: python3 が必要です（ZIP 内の日本語ファイル名を扱うため）。" >&2
    exit 1
fi

# 画像の縮小には macOS の sips か ImageMagick を使う
if command -v sips >/dev/null 2>&1; then
    RESIZER="sips"
elif command -v magick >/dev/null 2>&1; then
    RESIZER="magick"
elif command -v convert >/dev/null 2>&1; then
    RESIZER="convert"
else
    echo "エラー: 画像を縮小するコマンドが見つかりません。" >&2
    echo "  macOS: 標準の sips が使われます" >&2
    echo "  Linux: sudo apt install imagemagick を実行してください" >&2
    exit 1
fi

echo "ZIP        : $ZIP_PATH"
echo "リサイズ   : $RESIZER"
echo "出力先     : $AVATAR_DIR"
echo ""

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# --- ZIP から必要な素材だけを取り出す ---------------------------------------
#
# ZIP 内のファイル名は環境によって次のように揺れるため、Python 側で
# 正規化したうえで突き合わせる。
#   - 文字コード : Windows 製 ZIP は CP932、それ以外は UTF-8
#   - Unicode 正規化 : macOS 由来のものは NFD（濁点が分離）、通常は NFC
#
# 出力ファイル名（app.js の AVATARS と対応）を <出力名>.gif として展開する。
# ball と pikachu-dance はユーザーが選ぶアバターではなく、
# それぞれ「ロトムの発言アイコン」「考え中の表示」に使うシステム用画像。

echo "ZIP から素材を取り出しています..."

python3 - "$ZIP_PATH" "$WORK_DIR" <<'PYTHON'
import sys, zipfile, pathlib, unicodedata

zip_path, dest = sys.argv[1], pathlib.Path(sys.argv[2])

MAPPINGS = {
    "ball":               "モンスターボール.gif",
    "pikachu-face":       "ピカチュウフェイス01.gif",
    "pikachu-face-happy": "ピカチュウフェイス09.gif",
    "pikachu-dance":      "ピカチュウ_ダンス.gif",
    "pikachu":            "ピカチュウ01.gif",
    "eevee":              "イーブイ01.gif",
    "squirtle":           "ゼニガメ01.gif",
    "charmander":         "ヒトカゲ01.gif",
    "bulbasaur":          "フシギダネ01.gif",
    "sobble":             "メッソン01.gif",
    "scorbunny":          "ヒバニー01.gif",
    "grookey":            "サルノリ01.gif",
    "psyduck":            "コダック01.gif",
    "jigglypuff":         "プリン01.gif",
    "snorlax":            "カビゴン01.gif",
    "ditto":              "メタモン01.gif",
    "lapras":             "ラプラス01.gif",
    "rowlet":             "モクロー01.gif",
}

def decode_name(info):
    # 0x800 が立っていればファイル名は UTF-8 として格納されている
    if info.flag_bits & 0x800:
        return info.filename
    raw = info.filename.encode("cp437", errors="replace")
    for enc in ("cp932", "utf-8"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return info.filename

def key(name):
    # NFD/NFC の揺れを吸収するため NFC に統一して比較する
    return unicodedata.normalize("NFC", name)

dest.mkdir(parents=True, exist_ok=True)

with zipfile.ZipFile(zip_path) as zf:
    # 基底名 → メンバー の索引を作る（フォルダ構成の変更に影響されないようにする）
    index = {}
    for info in zf.infolist():
        if info.is_dir():
            continue
        base = pathlib.PurePosixPath(decode_name(info).replace("\\", "/")).name
        index.setdefault(key(base), info)

    found, missing = [], []
    for out_name, src_name in MAPPINGS.items():
        info = index.get(key(src_name))
        if info is None:
            missing.append(src_name)
            continue
        with zf.open(info) as src, open(dest / f"{out_name}.gif", "wb") as dst:
            dst.write(src.read())
        found.append(out_name)

if missing:
    print("", file=sys.stderr)
    print("警告: ZIP 内に見つからなかった素材があります:", file=sys.stderr)
    for m in missing:
        print(f"  - {m}", file=sys.stderr)
    print("", file=sys.stderr)
    print("素材の構成が変わった可能性があります。", file=sys.stderr)
    print("このスクリプトの MAPPINGS を更新してください。", file=sys.stderr)
PYTHON

TOTAL=18
FOUND=$(find "$WORK_DIR" -maxdepth 1 -name '*.gif' | wc -l | tr -d ' ')

if [ "$FOUND" -eq 0 ]; then
    echo "" >&2
    echo "エラー: ZIP から素材を取り出せませんでした。" >&2
    echo "  $ZIP_NAME が正しいファイルか確認してください。" >&2
    exit 1
fi

# --- 画像を生成 -------------------------------------------------------------

mkdir -p "$AVATAR_DIR"

# UI モックは Git 管理対象外のローカル資産。存在する場合だけ画像を配置する
if [ -d "$MOCK_DIR" ] || [ -d "$(dirname "$MOCK_DIR")" ]; then
    mkdir -p "$MOCK_DIR"
    WITH_MOCK=1
else
    WITH_MOCK=0
fi

echo "画像を生成しています..."

for src_path in "$WORK_DIR"/*.gif; do
    out_name="$(basename "$src_path" .gif)"

    # アプリ用: 160px の PNG（透過を保持したまま軽量化）
    case "$RESIZER" in
        sips)
            sips -s format png -Z "$AVATAR_SIZE" "$src_path" \
                 --out "$AVATAR_DIR/$out_name.png" >/dev/null
            ;;
        magick)
            magick "$src_path" -resize "${AVATAR_SIZE}x${AVATAR_SIZE}>" "$AVATAR_DIR/$out_name.png"
            ;;
        convert)
            convert "$src_path" -resize "${AVATAR_SIZE}x${AVATAR_SIZE}>" "$AVATAR_DIR/$out_name.png"
            ;;
    esac

    # UI モック用: 原寸の GIF（docs/ui-mock/*.html から参照される）
    if [ "$WITH_MOCK" -eq 1 ]; then
        cp "$src_path" "$MOCK_DIR/$out_name.gif"
    fi
done

echo ""
echo "完了: ${FOUND}/${TOTAL} 件"
echo "  アバター(PNG): $AVATAR_DIR"
if [ "$WITH_MOCK" -eq 1 ]; then
    echo "  モック用(GIF): $MOCK_DIR"
fi
echo ""
echo "素材は再配布不可のため Git 管理対象外です（.gitignore 参照）。"

# 一部でも欠けていれば異常終了させ、CI や手作業で気付けるようにする
if [ "$FOUND" -ne "$TOTAL" ]; then
    exit 1
fi

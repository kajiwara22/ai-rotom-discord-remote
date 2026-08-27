#!/bin/bash
# モデル追加時の検証スクリプト（ADR-0015）。
#
# OpenCode Go の /models で一覧を取得し、候補モデルごとに
#   - reasoning_effort の受容（200 / 400 / 黙殺）
#   - ツール呼び出し（tool_calls）が返るか
#   - 応答速度
# を実測する。結果を見て rpi-bridge/src/model-registry.ts の許可リストに追加する。
#
# 使い方:
#   ./scripts/probe-models.sh                 # 一覧だけ表示
#   ./scripts/probe-models.sh <model-id> ...  # 指定したモデルを実測
#   ./scripts/probe-models.sh --all           # 一覧の全モデルを実測（量に注意）
#
# API キーは OPENCODE_GO_API_KEY / OPENCODE_GO_BASE_URL 環境変数、または
# rpi-bridge/.env から読む。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/rpi-bridge/.env"

# .env があれば読み込む（既存の環境変数は上書きしない）
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

API_KEY="${OPENCODE_GO_API_KEY:-}"
BASE_URL="${OPENCODE_GO_BASE_URL:-https://opencode.ai/zen/go/v1}"

if [ -z "$API_KEY" ]; then
  echo "エラー: OPENCODE_GO_API_KEY が設定されていません（env または rpi-bridge/.env）。" >&2
  exit 1
fi

list_models() {
  curl -sS -H "Authorization: Bearer $API_KEY" "$BASE_URL/models" \
    | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception as e:
    print("一覧の取得に失敗:", e, file=sys.stderr); sys.exit(1)
data = d.get("data", d) if isinstance(d, dict) else d
for m in data:
    if isinstance(m, dict) and m.get("id"):
        print(m["id"])
'
}

probe() {
  local model="$1"
  echo "===== $model ====="

  # reasoning_effort の受容確認（low / none / high で試す）
  for re in low none high; do
    local payload
    payload=$(python3 -c 'import json,sys; print(json.dumps({
        "model": sys.argv[1],
        "messages": [{"role":"user","content":"こんにちは。短く返して。"}],
        "max_tokens": 50,
        "reasoning_effort": sys.argv[2],
    }))' "$model" "$re")
    local started status body elapsed fin
    started=$(date +%s%3N)
    body=$(curl -sS -w '\n%{http_code}' -H "Authorization: Bearer $API_KEY" \
      -H "Content-Type: application/json" -d "$payload" "$BASE_URL/chat/completions")
    status=$(printf '%s' "$body" | tail -n1)
    elapsed=$(( $(date +%s%3N) - started ))
    if [ "$status" = "200" ]; then
      fin=$(printf '%s' "$body" | sed '$d' | python3 -c 'import json,sys; print(json.load(sys.stdin).get("choices",[{}])[0].get("finish_reason","?"))' 2>/dev/null || echo "?")
      echo "  reasoning_effort=$re : 200 (finish=$fin) ${elapsed}ms"
    else
      echo "  reasoning_effort=$re : $status ${elapsed}ms"
    fi
  done

  # ツール呼び出しが返るか（簡単な function を 1 つ渡す）
  local tool_payload tool_body tool_calls
  tool_payload=$(python3 -c 'import json,sys; print(json.dumps({
      "model": sys.argv[1],
      "messages": [{"role":"user","content":"今日の天気を教えて"}],
      "max_tokens": 100,
      "tools": [{"type":"function","function":{"name":"get_weather","description":"天気を取得","parameters":{"type":"object","properties":{}}}}],
      "tool_choice": "auto",
  }))' "$model")
  tool_body=$(curl -sS -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
    -d "$tool_payload" "$BASE_URL/chat/completions")
  tool_calls=$(printf '%s' "$tool_body" | python3 -c '
import json,sys
try:
    d = json.load(sys.stdin)
    msg = d.get("choices",[{}])[0].get("message",{})
    print(len(msg.get("tool_calls") or []))
except Exception:
    print("?")
' 2>/dev/null || echo "?")
  echo "  tool_calls=$tool_calls"
  echo ""
}

if [ "$#" -eq 0 ]; then
  echo "モデル一覧（--all で全実測、または ID を指定）:"
  list_models
  exit 0
fi

if [ "$1" = "--all" ]; then
  while IFS= read -r m; do
    [ -n "$m" ] && probe "$m"
  done < <(list_models)
else
  for m in "$@"; do
    probe "$m"
  done
fi

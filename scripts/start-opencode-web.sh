#!/bin/bash

# OpenCode Web Startup Script for GitHub Codespaces

set -e

# --- xdg-open ダミーコマンドの作成 ---
# Codespaces のコンテナには xdg-open が存在せず、
# OpenCode がブラウザ起動を試みてクラッシュするため、
# 呼ばれても何もせず正常終了するダミーを配置する。
if ! command -v xdg-open >/dev/null 2>&1; then
    DUMMY_BIN="$HOME/.local/bin"
    mkdir -p "$DUMMY_BIN"
    cat > "$DUMMY_BIN/xdg-open" <<'EOF'
#!/bin/bash
# ブラウザ自動起動を抑止するためのダミー。何もせず正常終了する。
exit 0
EOF
    chmod +x "$DUMMY_BIN/xdg-open"
    export PATH="$DUMMY_BIN:$PATH"
fi

# Build the access URL
if [ -n "$CODESPACE_NAME" ] && [ -n "$GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN" ]; then
    ACCESS_URL="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
else
    # Fallback for local development or missing env vars
    ACCESS_URL="http://localhost:3000"
fi

# ブラウザ自動起動を抑止（Codespaces には xdg-open が無いため）
export BROWSER=none

# Display startup message
echo ""
echo "============================================"
echo "🚀 OpenCode Web is starting..."
echo ""
echo "📱 Access URL:"
echo ""
echo "$ACCESS_URL"
echo ""
echo "============================================"
echo ""

# Set working directory (Codespaces-only)
# Determine repo root from this script location to avoid depending on environment variables.
WORKSPACE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Create workspace directory if it doesn't exist
mkdir -p "$WORKSPACE_DIR"

# Start OpenCode Web
cd "$WORKSPACE_DIR"
exec npx -y opencode-ai@latest web --mdns --port 3000

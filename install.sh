#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.claude/statusline-command.sh"

# Install jq if missing
if ! command -v jq >/dev/null 2>&1; then
    echo "jq is required but not installed."
    if command -v brew >/dev/null 2>&1; then
        read -rp "Install jq via Homebrew? [y/N] " answer
        [[ "$answer" =~ ^[Yy] ]] || { echo "Aborted. Install jq manually: https://jqlang.github.io/jq/download/"; exit 1; }
        brew install jq
    elif command -v apt-get >/dev/null 2>&1; then
        read -rp "Install jq via apt? (requires sudo) [y/N] " answer
        [[ "$answer" =~ ^[Yy] ]] || { echo "Aborted. Install jq manually: https://jqlang.github.io/jq/download/"; exit 1; }
        sudo apt-get update && sudo apt-get install -y jq
    elif command -v dnf >/dev/null 2>&1; then
        read -rp "Install jq via dnf? (requires sudo) [y/N] " answer
        [[ "$answer" =~ ^[Yy] ]] || { echo "Aborted. Install jq manually: https://jqlang.github.io/jq/download/"; exit 1; }
        sudo dnf install -y jq
    elif command -v pacman >/dev/null 2>&1; then
        read -rp "Install jq via pacman? (requires sudo) [y/N] " answer
        [[ "$answer" =~ ^[Yy] ]] || { echo "Aborted. Install jq manually: https://jqlang.github.io/jq/download/"; exit 1; }
        sudo pacman -S --noconfirm jq
    else
        echo "Error: Could not install jq automatically. Please install it manually:"
        echo "  https://jqlang.github.io/jq/download/"
        exit 1
    fi
fi

# Copy script
mkdir -p "$HOME/.claude"
install -m 755 "$SCRIPT_DIR/statusline-command.sh" "$DEST"

# Configure Claude Code settings
SETTINGS="$HOME/.claude/settings.json"
if [ -f "$SETTINGS" ]; then
    cp "$SETTINGS" "${SETTINGS}.bak"
    tmp=$(mktemp)
    trap 'rm -f "$tmp"' EXIT
    jq '.statusLine = {"type": "command", "command": "bash ~/.claude/statusline-command.sh"}' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
    echo "Updated existing $SETTINGS (backup: ${SETTINGS}.bak)"
else
    cat > "$SETTINGS" <<'EOF'
{
  "statusLine": {
    "type": "command",
    "command": "bash ~/.claude/statusline-command.sh"
  }
}
EOF
    echo "Created $SETTINGS"
fi

echo "Installed! Restart Claude Code to see the new statusline."

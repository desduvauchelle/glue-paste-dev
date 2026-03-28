#!/bin/bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

REPO="desduvauchelle/glue-paste-dev"
INSTALL_DIR="$HOME/.glue-paste-dev"
BIN_DIR="$INSTALL_DIR/bin"
PORT=4242

# ─── Helpers ──────────────────────────────────────────────────────────────────

info()  { echo -e "${BLUE}▸${NC} $1"; }
ok()    { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}!${NC} $1"; }
fail()  { echo -e "${RED}✗${NC} $1"; exit 1; }

detect_os() {
  case "$(uname -s)" in
    Darwin*) echo "macos" ;;
    Linux*)  echo "linux" ;;
    *)       echo "unknown" ;;
  esac
}

# Parse JSON value for a given key (portable — no jq required)
json_value() {
  local key="$1" json="$2"
  echo "$json" | sed -n 's/.*"'"$key"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1
}

# Find all browser_download_url values and filter for our tarball
json_download_url() {
  local json="$1"
  echo "$json" | grep '"browser_download_url"' | grep 'glue-paste-dev.tar.gz' | sed 's/.*"browser_download_url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' | head -1
}

# Detect shell profile file
detect_shell_profile() {
  local shell_name
  shell_name="$(basename "${SHELL:-/bin/bash}")"

  case "$shell_name" in
    zsh)  echo "$HOME/.zshrc" ;;
    bash)
      if [ -f "$HOME/.bashrc" ]; then
        echo "$HOME/.bashrc"
      elif [ -f "$HOME/.bash_profile" ]; then
        echo "$HOME/.bash_profile"
      else
        echo "$HOME/.bashrc"
      fi
      ;;
    fish) echo "$HOME/.config/fish/config.fish" ;;
    *)    echo "$HOME/.profile" ;;
  esac
}

# Kill process on a port (cross-platform)
kill_port() {
  local port="$1"
  if command -v lsof &>/dev/null; then
    local pids
    pids=$(lsof -ti :"$port" 2>/dev/null || true)
    if [ -n "$pids" ]; then
      echo "$pids" | xargs kill -9 2>/dev/null || true
    fi
  elif command -v fuser &>/dev/null; then
    fuser -k "$port/tcp" 2>/dev/null || true
  fi
}

# ─── Banner ───────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}GluePasteDev Installer${NC}"
echo ""

OS="$(detect_os)"
if [ "$OS" = "unknown" ]; then
  fail "Unsupported operating system. GluePasteDev supports macOS and Linux."
fi

# ─── Step 1: Check / install Bun ─────────────────────────────────────────────

if command -v bun &>/dev/null; then
  ok "Bun found ($(bun --version))"
else
  info "Bun not found — installing..."

  if [ "$OS" = "macos" ] && command -v brew &>/dev/null; then
    brew install oven-sh/bun/bun || curl -fsSL https://bun.sh/install | bash
  else
    curl -fsSL https://bun.sh/install | bash
  fi

  # Source bun into current session
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"

  if ! command -v bun &>/dev/null; then
    fail "Bun installation failed. Install manually: https://bun.sh"
  fi

  ok "Bun installed ($(bun --version))"
fi

# ─── Step 2: Check for Claude CLI ────────────────────────────────────────────

if command -v claude &>/dev/null; then
  ok "Claude CLI found"
else
  warn "Claude CLI not found — GluePasteDev needs it to execute tasks."

  if command -v npm &>/dev/null; then
    info "Installing Claude CLI via npm..."
    npm install -g @anthropic-ai/claude-code 2>/dev/null && ok "Claude CLI installed" || warn "Auto-install failed. Install manually: https://docs.anthropic.com/en/docs/claude-code"
  else
    echo "  Install it from: https://docs.anthropic.com/en/docs/claude-code"
  fi
fi

# ─── Step 3: Fetch latest release ────────────────────────────────────────────

info "Fetching latest release..."

RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest") \
  || fail "Failed to reach GitHub API. Check your internet connection."

VERSION=$(json_value "tag_name" "$RELEASE_JSON")
DOWNLOAD_URL=$(json_download_url "$RELEASE_JSON")

if [ -z "$VERSION" ]; then
  fail "Could not determine latest version. Check https://github.com/$REPO/releases"
fi

if [ -z "$DOWNLOAD_URL" ]; then
  fail "Release tarball not found for $VERSION. Check https://github.com/$REPO/releases"
fi

# ─── Step 4: Stop existing daemon ─────────────────────────────────────────────

if [ -f "$INSTALL_DIR/glue-paste-dev.pid" ]; then
  PID=$(cat "$INSTALL_DIR/glue-paste-dev.pid")
  if kill -0 "$PID" 2>/dev/null; then
    info "Stopping running daemon (PID $PID)..."
    kill "$PID" 2>/dev/null || true
    sleep 2
  fi
fi

kill_port "$PORT"

# ─── Step 5: Download and install ─────────────────────────────────────────────

info "Downloading $VERSION..."

rm -rf "$INSTALL_DIR/server" "$INSTALL_DIR/cli"
mkdir -p "$INSTALL_DIR"

curl -fsSL "$DOWNLOAD_URL" | tar -xz -C "$INSTALL_DIR" \
  || fail "Download or extraction failed."

chmod +x "$INSTALL_DIR/cli/src/index.ts"

ok "Downloaded and extracted"

# ─── Step 6: Create symlinks ─────────────────────────────────────────────────

mkdir -p "$BIN_DIR"
ln -sf "$INSTALL_DIR/cli/src/index.ts" "$BIN_DIR/glue-paste-dev"

# Try /usr/local/bin for convenience (may need sudo — silently skip if it fails)
ln -sf "$INSTALL_DIR/cli/src/index.ts" /usr/local/bin/glue-paste-dev 2>/dev/null || true

# ─── Step 7: Ensure PATH ─────────────────────────────────────────────────────

export PATH="$BIN_DIR:$PATH"

if ! echo "$PATH" | grep -q "$BIN_DIR"; then
  export PATH="$BIN_DIR:$PATH"
fi

SHELL_PROFILE="$(detect_shell_profile)"
SHELL_NAME="$(basename "${SHELL:-/bin/bash}")"

if [ -n "$SHELL_PROFILE" ]; then
  if ! grep -q "$BIN_DIR" "$SHELL_PROFILE" 2>/dev/null; then
    echo "" >> "$SHELL_PROFILE"
    echo "# GluePasteDev" >> "$SHELL_PROFILE"
    if [ "$SHELL_NAME" = "fish" ]; then
      echo "set -gx PATH $BIN_DIR \$PATH" >> "$SHELL_PROFILE"
    else
      echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$SHELL_PROFILE"
    fi
    ok "Added to PATH in $SHELL_PROFILE"
  fi
fi

# ─── Step 8: Start the daemon ────────────────────────────────────────────────

echo ""
info "Starting GluePasteDev..."

if command -v glue-paste-dev &>/dev/null; then
  glue-paste-dev start
elif [ -x "$BIN_DIR/glue-paste-dev" ]; then
  "$BIN_DIR/glue-paste-dev" start
else
  bun run "$INSTALL_DIR/cli/src/index.ts" start
fi

# ─── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}GluePasteDev $VERSION installed and running!${NC}"
echo ""
echo -e "  Dashboard:  ${BOLD}http://localhost:$PORT${NC}"
echo ""
echo "  Commands:"
echo "    glue-paste-dev start     Start the server"
echo "    glue-paste-dev stop      Stop the server"
echo "    glue-paste-dev status    Check server status"
echo "    glue-paste-dev update    Update to latest version"
echo ""
if ! command -v glue-paste-dev &>/dev/null; then
  echo -e "${YELLOW}Note: Run this to activate the command in your current terminal:${NC}"
  echo ""
  echo "  source $SHELL_PROFILE"
  echo ""
  echo -e "${YELLOW}Or restart your terminal for the command to be available everywhere.${NC}"
  echo ""
fi

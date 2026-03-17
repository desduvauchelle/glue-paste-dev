#!/bin/bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

REPO="desduvauchelle/glue-paste-dev"
INSTALL_DIR="$HOME/.glue-paste-dev"

echo -e "${YELLOW}Installing GluePasteDev...${NC}"

# Check for bun
if ! command -v bun &> /dev/null; then
  echo -e "${YELLOW}Bun not found. Installing...${NC}"
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

# Check for Claude CLI
if ! command -v claude &> /dev/null; then
  echo -e "${YELLOW}Warning: Claude CLI not found.${NC}"
  echo "Install it from: https://docs.anthropic.com/en/docs/claude-code"
  echo "GluePasteDev requires Claude CLI to execute tasks."
fi

# Fetch latest release info
RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")

VERSION=$(echo "$RELEASE_JSON" | grep '"tag_name"' | head -1 | cut -d '"' -f 4)
DOWNLOAD_URL=$(echo "$RELEASE_JSON" | grep '"browser_download_url"' | grep 'glue-paste-dev.tar.gz' | head -1 | cut -d '"' -f 4)

if [ -z "$DOWNLOAD_URL" ]; then
  echo -e "${RED}Failed to find latest release. Check https://github.com/$REPO/releases${NC}"
  exit 1
fi

echo "Downloading ${VERSION}..."

# Stop daemon if running
if [ -f "$INSTALL_DIR/glue-paste-dev.pid" ]; then
  PID=$(cat "$INSTALL_DIR/glue-paste-dev.pid")
  if kill -0 "$PID" 2>/dev/null; then
    echo "Stopping running daemon..."
    kill "$PID" 2>/dev/null || true
    sleep 2
  fi
fi

# Kill any orphaned process still holding port 4242
STALE_PIDS=$(lsof -ti :4242 2>/dev/null || true)
if [ -n "$STALE_PIDS" ]; then
  echo "$STALE_PIDS" | xargs kill -9 2>/dev/null || true
  sleep 1
fi

# Clean previous installation (keep data dir for PID/logs)
rm -rf "$INSTALL_DIR/server" "$INSTALL_DIR/cli"
mkdir -p "$INSTALL_DIR"

# Download and extract
curl -fsSL "$DOWNLOAD_URL" | tar -xz -C "$INSTALL_DIR"

# Ensure CLI entry is executable
chmod +x "$INSTALL_DIR/cli/src/index.ts"

# Create symlink
echo "Creating CLI symlink..."
BIN_DIR="$INSTALL_DIR/bin"
mkdir -p "$BIN_DIR"
ln -sf "$INSTALL_DIR/cli/src/index.ts" "$BIN_DIR/glue-paste-dev"

# Also try /usr/local/bin for convenience
ln -sf "$INSTALL_DIR/cli/src/index.ts" /usr/local/bin/glue-paste-dev 2>/dev/null || true

# Ensure BIN_DIR is on PATH
if ! echo "$PATH" | grep -q "$BIN_DIR"; then
  SHELL_PROFILE=""
  if [ -f "$HOME/.zshrc" ]; then
    SHELL_PROFILE="$HOME/.zshrc"
  elif [ -f "$HOME/.bashrc" ]; then
    SHELL_PROFILE="$HOME/.bashrc"
  elif [ -f "$HOME/.bash_profile" ]; then
    SHELL_PROFILE="$HOME/.bash_profile"
  fi

  EXPORT_LINE="export PATH=\"$BIN_DIR:\$PATH\""

  if [ -n "$SHELL_PROFILE" ]; then
    if ! grep -q "$BIN_DIR" "$SHELL_PROFILE" 2>/dev/null; then
      echo "" >> "$SHELL_PROFILE"
      echo "# GluePasteDev" >> "$SHELL_PROFILE"
      echo "$EXPORT_LINE" >> "$SHELL_PROFILE"
      echo -e "${GREEN}Added $BIN_DIR to PATH in $SHELL_PROFILE${NC}"
    fi
  fi

  export PATH="$BIN_DIR:$PATH"
fi

echo ""
echo -e "${GREEN}GluePasteDev ${VERSION} installed successfully!${NC}"
echo ""
echo "Usage:"
echo "  glue-paste-dev start    Start the server and open dashboard"
echo "  glue-paste-dev stop     Stop the server"
echo "  glue-paste-dev status   Check server status"
echo ""
echo "The dashboard will be available at http://localhost:4242"
echo ""
echo -e "${YELLOW}Note: Restart your terminal or run 'source ~/.zshrc' to use the command.${NC}"

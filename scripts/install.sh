#!/bin/bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

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

INSTALL_DIR="$HOME/.glue-paste-dev"
REPO_DIR="$INSTALL_DIR/repo"

mkdir -p "$INSTALL_DIR"

# Clone or update
if [ -d "$REPO_DIR" ]; then
  echo "Updating existing installation..."
  cd "$REPO_DIR" && git pull --ff-only
else
  echo "Cloning GluePasteDev..."
  git clone https://github.com/desduvauchelle/glue-paste-dev.git "$REPO_DIR"
fi

cd "$REPO_DIR"

# Install dependencies
echo "Installing dependencies..."
bun install

# Build dashboard
echo "Building dashboard..."
bun run build

# Ensure CLI entry is executable
chmod +x "$REPO_DIR/packages/cli/src/index.ts"

# Create symlink
echo "Creating CLI symlink..."
if [ -L /usr/local/bin/glue-paste-dev ]; then
  rm /usr/local/bin/glue-paste-dev
fi

ln -sf "$REPO_DIR/packages/cli/src/index.ts" /usr/local/bin/glue-paste-dev 2>/dev/null || {
  echo -e "${YELLOW}Could not create symlink in /usr/local/bin.${NC}"
  echo "You can add this to your PATH manually:"
  echo "  export PATH=\"$REPO_DIR/packages/cli/src:\$PATH\""
  echo "Or create the symlink with sudo:"
  echo "  sudo ln -sf $REPO_DIR/packages/cli/src/index.ts /usr/local/bin/glue-paste-dev"
}

echo ""
echo -e "${GREEN}GluePasteDev installed successfully!${NC}"
echo ""
echo "Usage:"
echo "  glue-paste-dev start    Start the server and open dashboard"
echo "  glue-paste-dev stop     Stop the server"
echo "  glue-paste-dev status   Check server status"
echo ""
echo "The dashboard will be available at http://localhost:4242"

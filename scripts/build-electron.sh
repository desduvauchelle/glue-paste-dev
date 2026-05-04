#!/bin/bash
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON_DIR="$REPO_ROOT/packages/electron"
RESOURCES_DIR="$ELECTRON_DIR/resources"

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
info() { echo -e "${BLUE}▸${NC} $1"; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }

info "Building dashboard..."
cd "$REPO_ROOT"
bun run build:dashboard

info "Copying dashboard to electron resources..."
mkdir -p "$RESOURCES_DIR/public"
cp -r "$REPO_ROOT/packages/server/public/." "$RESOURCES_DIR/public/"
ok "Dashboard copied"

info "Compiling server to standalone binary..."
mkdir -p "$RESOURCES_DIR"
bun build "$REPO_ROOT/packages/server/src/index.ts" \
  --compile \
  --outfile "$RESOURCES_DIR/server" \
  --target bun
chmod +x "$RESOURCES_DIR/server"
ok "Server binary built ($(du -sh "$RESOURCES_DIR/server" | cut -f1))"

info "Compiling electron main process..."
cd "$ELECTRON_DIR"
npx tsc
ok "Electron main compiled"

info "Packaging with electron-builder..."
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --publish never

ok "Built to packages/electron/dist-app/"
ls "$ELECTRON_DIR/dist-app/"

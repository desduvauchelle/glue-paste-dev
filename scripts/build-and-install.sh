#!/bin/bash
set -e

# Build GluePaste (Tauri app) from source and install to /Applications/.
# This replaces the previous Electron-based installer.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="GluePaste.app"
BUILT_APP="$REPO_ROOT/rust/target/release/bundle/macos/$APP_NAME"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info() { echo -e "${BLUE}▸${NC} $1"; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "This installer is macOS-only."

# Build
info "Building GluePaste (Tauri) from source..."
bash "$REPO_ROOT/scripts/build-tauri.sh"
[ -d "$BUILT_APP" ] || fail "Built app not found at $BUILT_APP"

# Stop any running instance
if pgrep -f "/Applications/$APP_NAME" >/dev/null 2>&1; then
  info "Quitting running GluePaste..."
  osascript -e 'quit app "GluePaste"' 2>/dev/null || true
  sleep 1
  pkill -f "/Applications/$APP_NAME" 2>/dev/null || true
fi

# Install
info "Installing to /Applications/..."
[ -d "/Applications/$APP_NAME" ] && rm -rf "/Applications/$APP_NAME"
cp -R "$BUILT_APP" /Applications/

# Strip macOS quarantine (app is unsigned)
info "Removing macOS quarantine..."
xattr -cr "/Applications/$APP_NAME"

ok "$APP_NAME installed to /Applications/"

# Launch
info "Launching GluePaste..."
open "/Applications/$APP_NAME"

echo ""
ok "Done! GluePaste built and installed."

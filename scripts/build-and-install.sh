#!/bin/bash
set -e

# Build GluePaste locally and install the freshly-built .app to /Applications/.
# One-click alternative to building, then downloading a release.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON_DIR="$REPO_ROOT/packages/electron"
DIST_APP="$ELECTRON_DIR/dist-app"
APP_NAME="GluePaste.app"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info() { echo -e "${BLUE}▸${NC} $1"; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "This installer is macOS-only."

# ─── Step 1: Build ───────────────────────────────────────────────────────────
info "Building GluePaste from source..."
bash "$REPO_ROOT/scripts/build-electron.sh"

# ─── Step 2: Locate the built .app (newest — dist-app keeps stale arch dirs) ──
BUILT_APP="$(ls -td "$DIST_APP"/*/"$APP_NAME" 2>/dev/null | head -1)"
[ -z "$BUILT_APP" ] && fail "Built app not found under $DIST_APP"
info "Built app: $BUILT_APP"

# ─── Step 3: Stop any running instance ───────────────────────────────────────
if pgrep -f "/Applications/$APP_NAME" >/dev/null 2>&1; then
  info "Quitting running GluePaste..."
  osascript -e 'quit app "GluePaste"' 2>/dev/null || true
  sleep 1
  pkill -f "/Applications/$APP_NAME" 2>/dev/null || true
fi

# ─── Step 4: Install to /Applications/ ───────────────────────────────────────
info "Installing to /Applications/..."
[ -d "/Applications/$APP_NAME" ] && rm -rf "/Applications/$APP_NAME"
cp -R "$BUILT_APP" /Applications/

# Required for unsigned apps — removes macOS quarantine flag
info "Removing macOS quarantine (app is unsigned)..."
xattr -cr "/Applications/$APP_NAME"

ok "$APP_NAME installed to /Applications/"

# ─── Step 5: Clear stale single-instance lock ────────────────────────────────
# A crashed/killed prior instance leaves an Electron SingletonLock behind that
# can silently block the next launch (app quits immediately, no window/log).
USERDATA="$HOME/Library/Application Support/@glue-paste-dev/electron"
rm -f "$USERDATA"/SingletonLock "$USERDATA"/SingletonCookie "$USERDATA"/SingletonSocket 2>/dev/null || true

# ─── Step 6: Launch ──────────────────────────────────────────────────────────
info "Launching GluePaste..."
open "/Applications/$APP_NAME"

echo ""
ok "Done! GluePaste built and installed."

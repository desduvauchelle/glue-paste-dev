#!/bin/bash
set -e

# Build GluePaste as a Tauri 2 app. Produces a macOS .app under
# rust/target/release/bundle/macos/GluePaste.app.
#
# Prerequisites:
#   - Rust toolchain (cargo)
#   - tauri-cli: cargo install tauri-cli --version "^2.0"
#   - Bun (for dashboard build)

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
info() { echo -e "${BLUE}▸${NC} $1"; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "Currently macOS-only; cross-platform support is Phase 6."

# Verify tauri-cli is installed
if ! cargo tauri --version >/dev/null 2>&1; then
  fail "tauri-cli not installed. Run: cargo install tauri-cli --version \"^2.0\""
fi

info "Building dashboard..."
cd "$REPO_ROOT/packages/dashboard"
bun run build
ok "Dashboard built"

info "Building Tauri app..."
cd "$REPO_ROOT/rust/crates/tauri-app"
cargo tauri build
ok "Tauri app built"

APP_PATH="$REPO_ROOT/rust/target/release/bundle/macos/GluePaste.app"
if [ -d "$APP_PATH" ]; then
  ok "Built: $APP_PATH"
else
  fail "Expected app not found at $APP_PATH"
fi

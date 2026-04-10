#!/bin/bash
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
REPO="desduvauchelle/glue-paste-dev"

info()  { echo -e "${BLUE}▸${NC} $1"; }
ok()    { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}!${NC} $1"; }
fail()  { echo -e "${RED}✗${NC} $1"; exit 1; }

detect_os() {
  case "$(uname -s)" in
    Darwin*) echo "macos" ;;
    Linux*)  echo "linux" ;;
    *)       fail "Unsupported OS: $(uname -s)" ;;
  esac
}

json_value() {
  echo "$2" | sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1
}

OS=$(detect_os)

echo ""
echo "  GluePaste Desktop App Installer"
echo "  ================================"
echo "  Builds locally for your architecture — no Apple signing needed."
echo ""

command -v bun >/dev/null 2>&1 || fail "bun is required. Install from https://bun.sh"
command -v npm >/dev/null 2>&1 || fail "npm is required (for electron-builder). Install Node.js from https://nodejs.org"

info "Fetching latest release info..."
RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest") \
  || fail "Could not reach GitHub API"
VERSION=$(json_value "tag_name" "$RELEASE_JSON")
[ -z "$VERSION" ] && fail "Could not parse release version"
info "Latest version: $VERSION"

TMP_DIR=$(mktemp -d /tmp/GluePaste-build-XXXXXX)
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

SOURCE_URL="https://github.com/$REPO/archive/refs/tags/${VERSION}.tar.gz"
info "Downloading source ($VERSION)..."
curl -fsSL -o "$TMP_DIR/source.tar.gz" "$SOURCE_URL"

info "Extracting source..."
tar -xzf "$TMP_DIR/source.tar.gz" -C "$TMP_DIR" --strip-components=1

BUILD_DIR="$TMP_DIR"

info "Installing dependencies..."
cd "$BUILD_DIR"
bun install --ignore-scripts

info "Building dashboard..."
bun run build:dashboard

ELECTRON_DIR="$BUILD_DIR/packages/electron"
RESOURCES_DIR="$ELECTRON_DIR/resources"
mkdir -p "$RESOURCES_DIR"

if [ "$OS" = "macos" ]; then
  HOST_ARCH=$(uname -m)
  if [ "$HOST_ARCH" = "arm64" ]; then
    EB_ARCH="--arm64"
  else
    EB_ARCH="--x64"
  fi

  info "Compiling server binary ($HOST_ARCH)..."
  bun build packages/server/src/index.ts \
    --compile \
    --outfile "$RESOURCES_DIR/server" \
    --target bun
  chmod +x "$RESOURCES_DIR/server"

  info "Copying dashboard to resources..."
  mkdir -p "$RESOURCES_DIR/public"
  cp -r packages/server/public/. "$RESOURCES_DIR/public/"

  info "Packaging with electron-builder ($HOST_ARCH)..."
  ELECTRON_ISOLATED=$(mktemp -d /tmp/electron-pkg-XXXXXX)
  cp -r "$ELECTRON_DIR/." "$ELECTRON_ISOLATED/"
  cd "$ELECTRON_ISOLATED"
  npm install
  npx tsc
  npx electron-builder --mac dmg $EB_ARCH --publish never

  DMG=$(ls "$ELECTRON_ISOLATED/dist-app/"*.dmg 2>/dev/null | head -1)
  [ -z "$DMG" ] && fail "No DMG found after build. Check electron-builder output above."

  info "Mounting DMG..."
  MOUNT_OUT=$(hdiutil attach "$DMG" -nobrowse -quiet)
  MOUNT_POINT=$(echo "$MOUNT_OUT" | grep "/Volumes/" | awk '{print $NF}')
  [ -z "$MOUNT_POINT" ] && fail "Could not mount DMG"

  info "Installing to /Applications/..."
  [ -d "/Applications/GluePaste.app" ] && rm -rf "/Applications/GluePaste.app"
  cp -r "$MOUNT_POINT/GluePaste.app" /Applications/

  hdiutil detach "$MOUNT_POINT" -quiet

  ok "GluePaste.app installed to /Applications/"
  info "Open from Spotlight (Cmd+Space -> GluePaste) or the Applications folder."

elif [ "$OS" = "linux" ]; then
  info "Compiling server binary..."
  bun build packages/server/src/index.ts \
    --compile \
    --outfile "$RESOURCES_DIR/server" \
    --target bun
  chmod +x "$RESOURCES_DIR/server"

  info "Copying dashboard to resources..."
  mkdir -p "$RESOURCES_DIR/public"
  cp -r packages/server/public/. "$RESOURCES_DIR/public/"

  info "Packaging with electron-builder..."
  ELECTRON_ISOLATED=$(mktemp -d /tmp/electron-pkg-XXXXXX)
  cp -r "$ELECTRON_DIR/." "$ELECTRON_ISOLATED/"
  cd "$ELECTRON_ISOLATED"
  npm install
  npx tsc
  npx electron-builder --linux AppImage --publish never

  APPIMAGE=$(ls "$ELECTRON_ISOLATED/dist-app/"*.AppImage 2>/dev/null | head -1)
  [ -z "$APPIMAGE" ] && fail "No AppImage found after build. Check electron-builder output above."

  INSTALL_DIR="$HOME/.local/bin"
  mkdir -p "$INSTALL_DIR"
  INSTALL_PATH="$INSTALL_DIR/GluePaste"

  cp "$APPIMAGE" "$INSTALL_PATH"
  chmod +x "$INSTALL_PATH"

  ok "GluePaste installed to $INSTALL_PATH"

  if ! echo "$PATH" | grep -q "$INSTALL_DIR"; then
    warn "$INSTALL_DIR is not in your PATH."
    warn "Add to your shell profile:  export PATH=\"\$HOME/.local/bin:\$PATH\""
  fi

  info "Run with: GluePaste"
fi

echo ""
ok "Done!"

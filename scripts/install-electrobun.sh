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

download_url_for() {
  local pattern="$1" json="$2"
  echo "$json" | grep '"browser_download_url"' | grep "$pattern" \
    | sed 's/.*"browser_download_url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' | head -1
}

OS=$(detect_os)

echo ""
echo "  GluePaste Desktop App Installer"
echo "  ================================"
echo ""

info "Fetching latest release..."
RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest") \
  || fail "Could not reach GitHub API"
VERSION=$(json_value "tag_name" "$RELEASE_JSON")
[ -z "$VERSION" ] && fail "Could not parse release version"
info "Latest version: $VERSION"

if [ "$OS" = "macos" ]; then
  ARCH=$(uname -m)
  if [ "$ARCH" = "arm64" ]; then
    PATTERN="stable-mac-arm64"
  else
    PATTERN="stable-mac-x64"
  fi

  DOWNLOAD_URL=$(download_url_for "$PATTERN" "$RELEASE_JSON")
  [ -z "$DOWNLOAD_URL" ] && fail "No DMG found for arch $ARCH in release $VERSION"

  TMP_DMG=$(mktemp /tmp/GluePaste-XXXXXX.dmg)
  info "Downloading DMG ($ARCH)..."
  curl -fL -o "$TMP_DMG" "$DOWNLOAD_URL"

  info "Mounting DMG..."
  MOUNT_OUT=$(hdiutil attach "$TMP_DMG" -nobrowse -quiet)
  MOUNT_POINT=$(echo "$MOUNT_OUT" | grep "/Volumes/" | awk '{print $NF}')
  [ -z "$MOUNT_POINT" ] && fail "Could not mount DMG"

  info "Installing to /Applications/..."
  [ -d "/Applications/GluePaste.app" ] && rm -rf "/Applications/GluePaste.app"
  cp -r "$MOUNT_POINT/GluePaste.app" /Applications/

  hdiutil detach "$MOUNT_POINT" -quiet
  rm -f "$TMP_DMG"

  # Required for unsigned apps — removes macOS quarantine flag set on download
  info "Removing macOS quarantine (app is unsigned)..."
  xattr -cr /Applications/GluePaste.app

  ok "GluePaste.app installed to /Applications/"
  info "Open from Spotlight (Cmd+Space -> GluePaste) or the Applications folder."

elif [ "$OS" = "linux" ]; then
  DOWNLOAD_URL=$(download_url_for "stable-linux" "$RELEASE_JSON")
  [ -z "$DOWNLOAD_URL" ] && fail "No Linux artifact found in release $VERSION"

  INSTALL_DIR="$HOME/.local/bin"
  mkdir -p "$INSTALL_DIR"
  INSTALL_PATH="$INSTALL_DIR/GluePaste"

  info "Downloading Linux build..."
  curl -fL -o "$INSTALL_PATH.tar.gz" "$DOWNLOAD_URL"
  tar -xzf "$INSTALL_PATH.tar.gz" -C "$INSTALL_DIR"
  chmod +x "$INSTALL_PATH"
  rm -f "$INSTALL_PATH.tar.gz"

  ok "GluePaste installed to $INSTALL_PATH"

  if ! echo "$PATH" | grep -q "$INSTALL_DIR"; then
    warn "$INSTALL_DIR is not in your PATH."
    warn "Add to your shell profile:  export PATH=\"\$HOME/.local/bin:\$PATH\""
  fi

  info "Run with: GluePaste"
fi

echo ""
ok "Done!"

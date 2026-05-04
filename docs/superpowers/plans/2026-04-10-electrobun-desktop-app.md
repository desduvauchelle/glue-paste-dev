# Electrobun Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `packages/electron` with an Electrobun desktop app that starts the Hono server, loads the dashboard in a WebKit window, and quits cleanly when the window is closed.

**Architecture:** The Electrobun main process (Bun) spawns the Hono server as a `Bun.spawn` subprocess, polls until it responds, then creates a `BrowserWindow` loading `http://localhost:4242`. An `onBeforeQuit` handler kills the subprocess. Dev mode (`GLUE_PASTE_DEV=1`) spawns the server from source with `bun run`; production packaging pre-compiles a server binary and the built dashboard into `packages/electrobun/resources/`.

**Tech Stack:** Electrobun v1 (`electrobun` npm package), Bun, TypeScript, Vitest

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `packages/electrobun/package.json` | Package config + Electrobun scripts |
| Create | `packages/electrobun/tsconfig.json` | TypeScript config for IDE + type check |
| Create | `packages/electrobun/electrobun.config.ts` | App identity, window config, build entrypoint |
| Create | `packages/electrobun/src/bun/server-manager.ts` | Pure functions for server args + ready polling |
| Create | `packages/electrobun/src/bun/server-manager.test.ts` | Unit tests for path logic |
| Create | `packages/electrobun/src/bun/index.ts` | Main Electrobun process |
| Create | `packages/electrobun/.gitignore` | Ignore generated `resources/` directory |
| Create | `scripts/build-electrobun.sh` | Build dashboard + compile server + package with Electrobun |
| Create | `scripts/install-electrobun.sh` | One-line installer for end users |
| Modify | `package.json` | Replace `build:electron`/`dev:electron` with `build:electrobun`/`dev:electrobun` |
| Modify | `README.md` | Add Desktop App install + usage section |
| Modify | `CLAUDE.md` | Add `packages/electrobun` to type-check table |
| Delete | `packages/electron/` | Replaced by packages/electrobun |
| Delete | `scripts/build-electron.sh` | Replaced by build-electrobun.sh |
| Delete | `scripts/install-electron.sh` | Replaced by install-electrobun.sh |

---

### Task 1: Create package.json and tsconfig.json

**Files:**
- Create: `packages/electrobun/package.json`
- Create: `packages/electrobun/tsconfig.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@glue-paste-dev/electrobun",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "GLUE_PASTE_DEV=1 electrobun dev",
    "build": "electrobun build --env=stable",
    "test": "bunx vitest run"
  },
  "dependencies": {
    "electrobun": "^1.0.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.0.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "types": ["bun-types"]
  },
  "include": ["src/**/*", "electrobun.config.ts"]
}
```

- [ ] **Step 3: Install dependencies**

Run from `packages/electrobun/`:
```bash
bun install
```

Expected: `node_modules/electrobun` exists.

- [ ] **Step 4: Commit**

```bash
git add packages/electrobun/package.json packages/electrobun/tsconfig.json
git commit -m "feat: scaffold packages/electrobun"
```

---

### Task 2: Create electrobun.config.ts

**Files:**
- Create: `packages/electrobun/electrobun.config.ts`

- [ ] **Step 1: Create config**

```typescript
export default {
  app: {
    name: "GluePaste",
    identifier: "dev.gluepaste.app",
    version: "0.1.0",
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
  },
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/electrobun/electrobun.config.ts
git commit -m "feat: add electrobun.config.ts"
```

---

### Task 3: Create server-manager.ts

**Files:**
- Create: `packages/electrobun/src/bun/server-manager.ts`

- [ ] **Step 1: Create server-manager.ts**

```typescript
import path from "path"

const PORT = 4242

/**
 * Returns the command array to spawn the Hono server.
 *
 * @param isDev  true when GLUE_PASTE_DEV=1 (run from source with bun)
 * @param currentDir  value of import.meta.dir from the caller
 */
export function getServerArgs(isDev: boolean, currentDir: string): string[] {
  if (isDev) {
    // Navigate from packages/electrobun/src/bun/ to packages/server/src/index.ts
    const serverSource = path.resolve(
      currentDir,
      "..",
      "..",
      "..",
      "server",
      "src",
      "index.ts"
    )
    return ["bun", "run", serverSource]
  }
  // Production: pre-compiled binary placed next to the bundled main process
  const serverBin = path.join(currentDir, "..", "resources", "server")
  return [serverBin]
}

export function startServer(
  args: string[]
): ReturnType<typeof Bun.spawn> {
  return Bun.spawn(args, {
    env: { ...process.env, PORT: String(PORT) },
    stdout: "inherit",
    stderr: "inherit",
  })
}

export async function waitForReady(timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${PORT}/api/boards`)
      if (res.ok) return true
    } catch {
      // not ready yet
    }
    await Bun.sleep(200)
  }
  return false
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/electrobun/src/bun/server-manager.ts
git commit -m "feat: add electrobun server-manager utilities"
```

---

### Task 4: Write and run server-manager tests

**Files:**
- Create: `packages/electrobun/src/bun/server-manager.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest"
import path from "path"
import { getServerArgs } from "./server-manager"

describe("getServerArgs - dev mode", () => {
  it("returns bun run with absolute path to server source", () => {
    const dir = "/repo/packages/electrobun/src/bun"
    const args = getServerArgs(true, dir)
    expect(args[0]).toBe("bun")
    expect(args[1]).toBe("run")
    expect(args[2]).toBe(
      path.resolve(dir, "..", "..", "..", "server", "src", "index.ts")
    )
    // resolves to /repo/packages/server/src/index.ts
  })
})

describe("getServerArgs - production mode", () => {
  it("returns path to compiled server binary", () => {
    const dir = "/app/bundle/bun"
    const args = getServerArgs(false, dir)
    expect(args).toEqual([path.join(dir, "..", "resources", "server")])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail (no implementation yet)**

Run from `packages/electrobun/`:
```bash
bunx vitest run
```

Expected: tests FAIL with "getServerArgs is not a function" or import errors since `server-manager.ts` was already created but we're verifying the test file itself works. If tests pass, that's expected too since Task 3 already created the implementation.

- [ ] **Step 3: Run tests to verify they pass**

```bash
cd packages/electrobun && bunx vitest run
```

Expected: 2 test suites, 2 tests, all passing.

- [ ] **Step 4: Commit**

```bash
git add packages/electrobun/src/bun/server-manager.test.ts
git commit -m "test: add server-manager unit tests for electrobun"
```

---

### Task 5: Create main process index.ts

**Files:**
- Create: `packages/electrobun/src/bun/index.ts`

- [ ] **Step 1: Create index.ts**

```typescript
import { BrowserWindow, onBeforeQuit } from "electrobun/bun"
import { getServerArgs, startServer, waitForReady } from "./server-manager"

const isDev = process.env.GLUE_PASTE_DEV === "1"
const serverArgs = getServerArgs(isDev, import.meta.dir)

console.log(`[electrobun] Starting server (dev=${isDev}): ${serverArgs.join(" ")}`)
const serverProc = startServer(serverArgs)

onBeforeQuit(() => {
  console.log("[electrobun] Stopping server...")
  serverProc.kill()
})

const ready = await waitForReady(20000)
if (!ready) {
  console.error("[electrobun] Server did not respond within 20 seconds. Exiting.")
  serverProc.kill()
  process.exit(1)
}

console.log("[electrobun] Server ready. Opening window.")

new BrowserWindow({
  title: "GluePaste",
  url: "http://localhost:4242",
  frame: { width: 1280, height: 820, x: 100, y: 100 },
})
```

- [ ] **Step 2: Run type check**

```bash
cd packages/electrobun && bunx tsc --noEmit
```

Expected: no type errors. If `electrobun/bun` types are missing, check that `bun install` completed and `node_modules/electrobun` exists. The `electrobun` package ships its own type declarations.

- [ ] **Step 3: Commit**

```bash
git add packages/electrobun/src/bun/index.ts
git commit -m "feat: add electrobun main process"
```

---

### Task 6: Create .gitignore for resources

**Files:**
- Create: `packages/electrobun/.gitignore`

- [ ] **Step 1: Create .gitignore**

```
resources/
artifacts/
```

- [ ] **Step 2: Commit**

```bash
git add packages/electrobun/.gitignore
git commit -m "chore: gitignore generated resources in electrobun"
```

---

### Task 7: Create build script

**Files:**
- Create: `scripts/build-electrobun.sh`

This script builds the dashboard, compiles the server binary, places both in `packages/electrobun/resources/`, then runs `electrobun build`.

- [ ] **Step 1: Create build-electrobun.sh**

```bash
#!/bin/bash
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ELECTROBUN_DIR="$REPO_ROOT/packages/electrobun"
RESOURCES_DIR="$ELECTROBUN_DIR/resources"

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
info() { echo -e "${BLUE}▸${NC} $1"; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }

info "Building dashboard..."
cd "$REPO_ROOT"
bun run build:dashboard
ok "Dashboard built"

info "Copying dashboard to electrobun resources..."
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

info "Packaging with Electrobun..."
cd "$ELECTROBUN_DIR"
bunx electrobun build --env=stable

ok "Built to packages/electrobun/artifacts/"
ls "$ELECTROBUN_DIR/artifacts/" 2>/dev/null || echo "(artifacts directory empty — check electrobun output above)"
```

- [ ] **Step 2: Make script executable**

```bash
chmod +x scripts/build-electrobun.sh
```

- [ ] **Step 3: Commit**

```bash
git add scripts/build-electrobun.sh
git commit -m "feat: add build-electrobun.sh packaging script"
```

---

### Task 8: Create install script

**Files:**
- Create: `scripts/install-electrobun.sh`

> **Note:** Electrobun artifact filenames follow `{channel}-{os}-{arch}` format. The exact filenames produced by `electrobun build --env=stable` must be verified by running Task 7 first and checking the `artifacts/` directory. The patterns below (`stable-mac-arm64`, `stable-mac-x64`) are based on Electrobun v1 conventions — adjust if actual output differs.

- [ ] **Step 1: Create install-electrobun.sh**

```bash
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
```

- [ ] **Step 2: Make script executable**

```bash
chmod +x scripts/install-electrobun.sh
```

- [ ] **Step 3: Commit**

```bash
git add scripts/install-electrobun.sh
git commit -m "feat: add install-electrobun.sh installer script"
```

---

### Task 9: Update root package.json

**Files:**
- Modify: `package.json`

Replace the `build:electron` and `dev:electron` scripts with Electrobun equivalents. Also remove the now-deleted packages/electron from any workspace references (workspaces are `"packages/*"` so no explicit change needed there).

- [ ] **Step 1: Edit package.json scripts**

In `package.json`, find and replace the two electron script lines:

Old:
```
"build:electron": "bash scripts/build-electron.sh",
"dev:electron": "cd packages/electron && npx electron dist/main.js",
```

New:
```
"build:electrobun": "bash scripts/build-electrobun.sh",
"dev:electrobun": "cd packages/electrobun && bun run dev",
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: replace electron scripts with electrobun in root package.json"
```

---

### Task 10: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

Add `packages/electrobun` to the type-check table.

- [ ] **Step 1: Add entry to type-check table in CLAUDE.md**

In the TypeScript section table, add after the `packages/cli` row:

```markdown
| `packages/electrobun` | `cd packages/electrobun && bunx tsc --noEmit` |
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add packages/electrobun to CLAUDE.md type-check table"
```

---

### Task 11: Update README.md

**Files:**
- Modify: `README.md`

Add a Desktop App section explaining how to install and use the Electrobun app, and update the Architecture table to include the new package.

- [ ] **Step 1: Add Desktop App section after the Install section**

After the `## Install` section and before `## Usage`, insert:

```markdown
## Desktop App

A standalone macOS/Linux desktop app built with [Electrobun](https://blackboard.sh/electrobun/) (WebKit + Bun). No terminal needed — click to open, close to stop everything.

### Install the desktop app

```bash
curl -fsSL https://raw.githubusercontent.com/desduvauchelle/glue-paste-dev/main/scripts/install-electrobun.sh | bash
```

Opens GluePaste.app directly from Spotlight or your Applications folder. When you close the window, the server stops automatically.

> **Note:** The app is unsigned. The install script removes the macOS quarantine flag automatically with `xattr -cr`.

### Build the desktop app (developers)

```bash
bun run build:electrobun
```

Artifacts are written to `packages/electrobun/artifacts/`. Requires Bun.

### Dev mode

```bash
bun run dev:electrobun
```

Runs the Electrobun shell with hot-reload. The server is spawned from source (`packages/server/src/index.ts`).
```

- [ ] **Step 2: Update Architecture table to include electrobun package**

In the `## Architecture` section, add a row:

```markdown
| `packages/electrobun` | Electrobun desktop app wrapper (WebKit window + server lifecycle) |
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add Desktop App section to README"
```

---

### Task 12: Remove packages/electron

**Files:**
- Delete: `packages/electron/` (entire directory)
- Delete: `scripts/build-electron.sh`
- Delete: `scripts/install-electron.sh`

- [ ] **Step 1: Remove the electron package and old scripts**

```bash
rm -rf packages/electron
rm scripts/build-electron.sh
rm scripts/install-electron.sh
```

- [ ] **Step 2: Verify dev environment still works**

```bash
bun run dev:server &
# Wait a few seconds, then:
curl http://localhost:4242/api/boards
```

Expected: JSON response (may be empty array `[]`). Kill the dev server after.

- [ ] **Step 3: Run all tests**

```bash
cd packages/core && bun test
cd ../server && bunx vitest run
cd ../dashboard && bunx vitest run
cd ../electrobun && bunx vitest run
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: replace packages/electron with packages/electrobun (Electrobun + WebKit)"
```

---

## Post-Implementation Notes

**Artifact filename verification:** After running `bun run build:electrobun` for the first time, check `packages/electrobun/artifacts/` for the actual artifact filenames. Update the `PATTERN` variables in `scripts/install-electrobun.sh` if they differ from `stable-mac-arm64` / `stable-mac-x64`.

**macOS quarantine:** The install script already handles this with `xattr -cr`. No code signing is set up — same as the previous Electron approach.

**Tray icon:** Not included (YAGNI). The app quits on window close via `exitOnLastWindowClosed: true`. Add tray support later if needed.

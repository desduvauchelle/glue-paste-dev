# Electron Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap Glue Paste into a self-contained macOS/Linux desktop app that launches the server on open, shows the dashboard in a native window, and shuts everything down on quit — no terminal required.

**Architecture:** New `packages/electron` package with an Electron 35 main process. The server is compiled to a standalone binary via `bun build --compile` (Bun runtime embedded, ~60 MB). The dashboard is pre-built static files placed alongside the binary in a `resources/` directory. `electron-builder` packages it all into a `.dmg` (macOS) / `.AppImage` (Linux). A separate `scripts/install-electron.sh` handles platform-specific installation including `xattr -cr` quarantine removal for unsigned macOS apps. Existing dev workflow (`bun run dev:server`, `bun run dev:dashboard`) is completely unchanged.

**Tech Stack:** Electron 35, electron-builder 26, TypeScript (tsc → CommonJS), `bun build --compile`

**Status: IMPLEMENTED** — All tasks completed.

---

## File Map

**Created:**
- `packages/electron/package.json`
- `packages/electron/tsconfig.json`
- `packages/electron/electron-builder.yml`
- `packages/electron/src/main.ts`
- `packages/electron/src/server-manager.ts`
- `packages/electron/src/server-manager.test.ts`
- `packages/electron/assets/loading.html`
- `scripts/build-electron.sh`
- `scripts/install-electron.sh`

**Modified:**
- `package.json` (root) — added `build:electron` and `dev:electron` scripts

---

## Key Architecture Notes

**Why `bun build --compile`?** It embeds the Bun runtime into a single binary. No need to bundle a separate Bun executable. `bun:sqlite`, Hono, and WebSockets all work since they're Bun built-ins.

**How does static file serving work?** The server uses `import.meta.dir` to locate `public/`. With a compiled binary, `import.meta.dir` resolves to the directory containing the binary at runtime. By placing `public/` next to the `server` binary in `resources/`, the server finds its static files automatically — no code changes needed.

**Resources layout (packaged app):**
```
GluePaste.app/Contents/Resources/
  server          <- standalone server binary (bun build --compile)
  public/         <- pre-built dashboard (index.html, assets/)
```

**Resources layout (dev mode of Electron):**
```
packages/electron/resources/
  server          <- same binary, built manually before running dev
  public/         <- copied from packages/server/public/
```

---

## Usage

### Build the distributable app

```bash
bun run build:electron
```

This runs `scripts/build-electron.sh` which:
1. Builds the dashboard (`packages/server/public/`)
2. Compiles the server to a standalone binary (`packages/electron/resources/server`)
3. Packages with electron-builder → `packages/electron/dist-app/`

### Run in dev mode (after building resources once)

```bash
# One-time resource build
bun run build:dashboard
mkdir -p packages/electron/resources/public
cp -r packages/server/public/. packages/electron/resources/public/
bun build packages/server/src/index.ts --compile --outfile packages/electron/resources/server --target bun

# Then launch
bun run dev:electron
```

### Install for end users

```bash
curl -fsSL https://raw.githubusercontent.com/desduvauchelle/glue-paste-dev/main/scripts/install-electron.sh | bash
```

---

## Notes

**App icon:** Add a 1024x1024 PNG at `packages/electron/assets/icon.png` before packaging a release. Without it the tray icon is invisible (app still works).

**macOS quarantine:** The app is unsigned. `install-electron.sh` runs `xattr -cr` automatically. If Gatekeeper still blocks, user can right-click → Open → Open once.

**Cross-compilation:** The server binary is compiled for the current host architecture. For multi-arch release builds, use CI matrix runners with `--target bun-macos-arm64` / `--target bun-macos-x64`.

# Phase 3 — Tauri Shell + Adapter Layer

**Goal:** Scaffold a Tauri 2 app at `rust/crates/tauri-app` that loads the existing React dashboard. Refactor the dashboard's `lib/api.ts` + `lib/ws.ts` behind an `IBackend` interface with two implementations: `httpBackend` (current REST/WS, default) and `ipcBackend` (skeleton, throws). App keeps working — Tauri is an alternate shell to Electron, both ship in parallel.

**Branch:** `feat/rust-migration-phase-3`. Base: `main` (post-Phase 2).

**Strangler-fig invariant:** No deletion of `packages/electron/`. No changes to Bun server. Dashboard still works in browser + Electron with `VITE_BACKEND=http` (default). Tauri loads dashboard which still talks to localhost Bun server via HTTP.

---

## Tasks

### Task 1: Add Tauri to Rust workspace

**Files:**
- Modify: `rust/Cargo.toml` (add tauri to workspace deps)
- Create: `rust/crates/tauri-app/Cargo.toml`
- Create: `rust/crates/tauri-app/build.rs`
- Create: `rust/crates/tauri-app/src/main.rs` (Tauri 2 minimal main)
- Create: `rust/crates/tauri-app/tauri.conf.json`
- Create: `rust/crates/tauri-app/icons/icon.png` (placeholder; reuse packages/electron/assets/icon.png)

Tauri 2 minimal main:
```rust
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

`tauri.conf.json` minimum (Tauri 2 schema):
```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "GluePaste",
  "version": "0.1.0",
  "identifier": "dev.gluepaste.app.tauri",
  "build": {
    "beforeDevCommand": "bun run --cwd ../../../packages/dashboard dev",
    "devUrl": "http://localhost:5173",
    "beforeBuildCommand": "bun run --cwd ../../../packages/dashboard build",
    "frontendDist": "../../../packages/dashboard/dist"
  },
  "app": {
    "windows": [
      {
        "title": "GluePaste",
        "width": 1280,
        "height": 820,
        "minWidth": 800,
        "minHeight": 600
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": ["icons/icon.png"]
  }
}
```

Workspace deps:
```toml
tauri = { version = "2", features = ["macos-private-api"] }
tauri-build = { version = "2", features = [] }
tauri-plugin-shell = "2"
```

Crate Cargo.toml:
```toml
[package]
name = "glue-paste-dev-tauri"
version.workspace = true
edition.workspace = true

[lib]
name = "glue_paste_dev_tauri_lib"
crate-type = ["staticlib", "cdylib", "rlib"]
path = "src/lib.rs"

[[bin]]
name = "glue-paste-dev-tauri"
path = "src/main.rs"

[build-dependencies]
tauri-build = { workspace = true }

[dependencies]
tauri = { workspace = true }
tauri-plugin-shell = { workspace = true }
glue-paste-dev-core = { path = "../core" }
serde = { workspace = true }
serde_json = { workspace = true }
tokio = { workspace = true }
```

Build script `rust/crates/tauri-app/build.rs`:
```rust
fn main() {
    tauri_build::build()
}
```

Add `"crates/tauri-app"` to workspace members.

Verify `cd rust && cargo build` (may pull a lot of deps; 5-10 min first time).

Commit: `feat(rust): scaffold tauri-app crate`

### Task 2: Verify Tauri loads dashboard against running Bun server

Manual test: start Bun server (`bun --cwd packages/server src/index.ts`) on port 4242. Build dashboard. Run `cargo tauri dev` or just `cargo run -p glue-paste-dev-tauri` after pointing `frontendDist` at the existing dashboard build.

Acceptance: Tauri window opens, shows dashboard, dashboard's API calls hit the running Bun server at localhost:4242 and display existing boards. Same data the Electron app shows.

If Tauri CLI not installed: `cargo install tauri-cli --version "^2.0"`.

Document any setup steps in commit message.

Commit: `feat(tauri-app): verified dashboard loads against bun server`

### Task 3: Dashboard IBackend abstraction

**Files:**
- Create: `packages/dashboard/src/lib/backend.ts` — interface definition + factory
- Create: `packages/dashboard/src/lib/backends/http.ts` — wraps current REST/WS behavior
- Create: `packages/dashboard/src/lib/backends/ipc.ts` — skeleton, throws "not implemented"
- Refactor: `packages/dashboard/src/lib/api.ts` — re-export via backend factory
- Refactor: `packages/dashboard/src/lib/ws.ts` — re-export via backend factory

`backend.ts`:
```typescript
import type { Board, /* etc */ } from "@glue-paste-dev/core";

export interface IBackend {
  boards: { list(): Promise<Board[]>; /* etc - mirror api.ts */ };
  cards: { /* mirror */ };
  // ... all resources
  ws: { subscribe(handler: (event: WSEvent) => void): () => void };
}

export type WSEvent = { type: string; payload: unknown };

let active: IBackend | null = null;

export async function getBackend(): Promise<IBackend> {
  if (active) return active;
  const mode = import.meta.env.VITE_BACKEND ?? "http";
  if (mode === "ipc") {
    const { ipcBackend } = await import("./backends/ipc");
    active = ipcBackend;
  } else {
    const { httpBackend } = await import("./backends/http");
    active = httpBackend;
  }
  return active;
}
```

`backends/http.ts`: extract the existing `api.ts` and `ws.ts` body into this module, export as `httpBackend`.

`backends/ipc.ts`: skeleton with same shape, every method throws `new Error("ipc backend not implemented yet (Phase 4 wires it)")`.

`api.ts` becomes a thin re-export shim that calls `getBackend()` lazily on each call. To avoid awaiting on every call, change the api surface to return functions that internally cache the backend Promise.

Or simpler: synchronously resolve at app start, set a global. Use a top-level await in main entry, or block first call. Pragmatic choice: do a synchronous import based on env var (since Vite resolves env at build time, this works):

```typescript
import { httpBackend } from "./backends/http";
import { ipcBackend } from "./backends/ipc";
const mode = import.meta.env.VITE_BACKEND ?? "http";
export const backend: IBackend = mode === "ipc" ? ipcBackend : httpBackend;
```

Both modules tree-shake-friendly if Vite is configured well. Acceptable to ship both for now.

Then in `api.ts` / `ws.ts`, replace internals with `backend.boards.list()` etc. All call sites elsewhere keep working — same surface.

Acceptance:
- `bunx tsc -b` on dashboard passes
- All dashboard tests pass (`bunx vitest run` in packages/dashboard)
- `VITE_BACKEND=http` (default): Electron app still works
- `VITE_BACKEND=ipc`: launch fails with the "not implemented" message in console (and UI breaks — that's expected)

Commit: `feat(dashboard): IBackend abstraction with http + ipc skeleton backends`

### Task 4: Tauri build script + install

Add to project root:
- Modify: `scripts/build-tauri.sh` (new) — builds dashboard + cargo tauri build
- Modify: `package.json` — add `build:tauri` script

`scripts/build-tauri.sh`:
```bash
#!/bin/bash
set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT/packages/dashboard" && bun run build
cd "$REPO_ROOT/rust" && cargo tauri build -- --release
echo "Built: rust/target/release/bundle/macos/GluePaste.app"
```

`package.json` scripts:
```json
"build:tauri": "bash scripts/build-tauri.sh"
```

Acceptance: `bun run build:tauri` produces a `.app` bundle on macOS. Tauri-built .app is in `rust/target/release/bundle/macos/GluePaste.app`.

Commit: `feat: add Tauri build script`

### Task 5: Update README + plan

Update `rust/README.md` + main migration roadmap with Phase 3 status.

Commit: `docs: Phase 3 complete (Tauri shell + adapter layer)`

---

## Acceptance

- [x] `cargo build` at `rust/` succeeds for entire workspace
- [x] `cargo tauri build` produces .app (may need `cargo install tauri-cli`)
- [x] Dashboard `tsc -b` + vitest pass
- [x] Electron app still works (`VITE_BACKEND` defaults to http)
- [x] No deletions of Bun packages

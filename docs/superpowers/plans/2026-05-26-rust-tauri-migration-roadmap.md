# Rust + Tauri IPC Migration Roadmap

> **For agentic workers:** This is a strategic roadmap, not an executable plan. Each phase has its own detailed plan file under `docs/superpowers/plans/`. Execute phases sequentially; do not skip ahead.

**Goal:** Replace the Bun + Electron backend stack with a Rust core embedded in a Tauri shell, communicating with the React dashboard via Tauri IPC instead of REST/WebSocket. The React frontend stays; everything below it gets rewritten.

**Why Tauri IPC (not local HTTP server in Tauri):**
- No port binding, no localhost CORS dance, no SingletonLock workarounds.
- Type-safe command boundary (`invoke<T>(...)` → Rust handler with serde).
- Native event channel replaces WebSocket broadcast.
- Smaller bundle, single process, faster cold start.
- Long-term cleaner contract — no parallel HTTP surface to maintain.

**Tradeoff accepted:** CLI tool (`glue-paste-dev add ...`) loses its current REST endpoint. CLI gets rewritten in Rust against the same core crate (in-process, not over HTTP).

---

## Architecture Target

```
┌─────────────────────────────────────────────────┐
│ Tauri app (single process)                       │
│                                                  │
│  ┌──────────────────┐    ┌────────────────────┐ │
│  │ React dashboard  │◄──►│ Rust core          │ │
│  │ (webview)        │IPC │  - db (rusqlite)   │ │
│  │  - api.ts wraps  │    │  - executor        │ │
│  │    invoke()      │    │  - cli-adapter     │ │
│  │  - ws.ts wraps   │    │  - stream-parser   │ │
│  │    listen()      │    │  - extract-report  │ │
│  └──────────────────┘    └────────────────────┘ │
└─────────────────────────────────────────────────┘

┌─────────────────────────┐
│ glue-paste-dev CLI      │  Rust binary, depends on
│ (separate binary)       │  same `core` crate via Cargo
└─────────────────────────┘
```

**Rust workspace layout:**
```
rust/
├── Cargo.toml                     # workspace
├── crates/
│   ├── core/                      # db, types, executor, schemas
│   ├── tauri-app/                 # tauri::Builder + IPC commands
│   └── cli/                       # clap CLI binary
└── target/
```

**TS type sharing:** `core` crate annotates its public types with `#[derive(ts_rs::TS)]`. Build step emits `.ts` files into `packages/dashboard/src/types/generated/`. Dashboard imports from there; no more cross-package type drift.

---

## Phases

Each phase produces a working, shippable artifact. App keeps running between phases — old Bun stack stays alive until Phase 6 retires it.

### Phase 1 — Rust core foundation (DB + types)

**Deliverable:** `rust/crates/core` crate with full DB parity to `bun:sqlite` layer. Generated TypeScript types output to `packages/dashboard/src/types/generated/`. Bun app still in use; nothing wired up yet.

**Detail plan:** `docs/superpowers/plans/2026-05-26-phase-1-rust-core-foundation.md`

**Acceptance:**
- All 9 tables created by Rust match `packages/core/src/db/schema.ts` byte-for-byte (verified by schema diff test).
- All CRUD ops have unit tests with TDD red→green→commit cycle.
- A Bun-created DB file opens cleanly in Rust; a Rust-created DB file opens cleanly in Bun.
- `cargo test -p glue-paste-dev-core` green.
- `ts-rs` emits `Board.ts`, `Card.ts`, etc. that drop-in replace current `@glue-paste-dev/core` type imports.

### Phase 2 — Rust executor port

**Deliverable:** Runner, stream-parser, cli-adapter, prompt builder, extract-report, fresh-env, process-cleanup, rate-limit detection, queue logic — all in Rust. Tokio-based subprocess streaming with callback trait. Bun app still in use; Rust executor verified standalone via integration tests that actually shell out to `echo` and a fake JSON-stream emitter.

**Detail plan:** `docs/superpowers/plans/2026-05-XX-phase-2-rust-executor.md` (written at phase start)

**Risk center.** This is the bulk of the migration. Stream-parser + extract-report are logic-dense. Plan must include parity tests against fixed Claude stream-json fixtures captured from Bun runtime.

**Acceptance:**
- Given identical input prompt + cli args, Rust runner produces same DB state changes as Bun runner (parity-tested with recorded fixtures).
- Process tree kill works cross-platform (macOS + linux + windows).
- Caffeinate spawning ported.
- `cargo test -p glue-paste-dev-core --features executor-tests` green with fixtures.

### Phase 3 — Tauri shell + dashboard adapter layer

**Deliverable:** `rust/crates/tauri-app` scaffolded. Loads existing dashboard build. Dashboard's `lib/api.ts` and `lib/ws.ts` refactored behind an `IBackend` interface with two implementations: `httpBackend` (current REST/WS, kept active) and `ipcBackend` (skeleton, throws "not implemented" for every call). Tauri build runs but `ipcBackend` not wired in yet — toggle via env var `VITE_BACKEND=ipc|http`.

**Detail plan:** `docs/superpowers/plans/2026-05-XX-phase-3-tauri-adapter.md`

**Acceptance:**
- `cargo tauri dev` opens Tauri window showing dashboard, backed by the existing Bun server over localhost (no IPC yet).
- All current dashboard tests still green.
- `VITE_BACKEND=http` (default) preserves current behavior end-to-end.
- `VITE_BACKEND=ipc` builds without TS errors, throws "not implemented" at runtime when any backend method is called.

### Phase 4 — IPC commands + event channel

**Deliverable:** Every REST endpoint and WS broadcast wired through Tauri IPC. `ipcBackend` fully implemented. Switch dashboard to `ipcBackend`. Bun server still runs in parallel for CLI use during this phase.

**Detail plan:** `docs/superpowers/plans/2026-05-XX-phase-4-ipc-commands.md`

**Approach:** Port routes one resource at a time (boards → cards → executions → comments → criteria → commits → config → queue → chat → ai → caffeinate → update → system → auth → tags → stats → files). Each resource: Rust `#[tauri::command]` handlers → wire into `ipcBackend` → switch dashboard hooks → delete REST calls. Commit after each resource.

**Acceptance:**
- Dashboard runs end-to-end against IPC only (Bun server stopped) — full kanban CRUD, card execution, real-time output streaming via `app.emit(...)` + `listen(...)`.
- WS event types preserved 1:1 (`card:updated`, `execution:output`, etc.) so dashboard hooks don't change shape.
- Tauri's permission allowlist locks IPC commands to the dashboard origin.

### Phase 5 — CLI rewrite

**Deliverable:** `rust/crates/cli` — `clap`-based replacement for `packages/cli`. Same subcommands (`start`, `stop`, `restart`, `status`, `logs`, `open`, `update`, `uninstall`, `add`). Daemon model changes: Tauri app IS the daemon; `start` opens the Tauri app, `add` opens the Tauri app via deep link or writes directly to the SQLite DB (file-locked).

**Detail plan:** `docs/superpowers/plans/2026-05-XX-phase-5-rust-cli.md`

**Acceptance:**
- `glue-paste-dev add "task title" -p boardName` creates card in DB visible to running Tauri app (via filesystem watcher or DB poll).
- All other subcommands work.
- Old `packages/cli` deleted.
- Single signed binary installed alongside the `.app`.

### Phase 6 — Retire Bun stack + ship

**Deliverable:** Delete `packages/server`, `packages/core` (the Bun one), `packages/electron`, `packages/cli`. Keep `packages/dashboard`. Tauri build replaces Electron build. New installer script.

**Detail plan:** `docs/superpowers/plans/2026-05-XX-phase-6-retire-bun.md`

**Acceptance:**
- Repo contains: `packages/dashboard` (React frontend only) + `rust/` (full backend).
- `bun run build` → `cargo tauri build` produces signed `.app` + `.dmg`.
- Existing user databases at `~/.glue-paste-dev/glue-paste-dev.db` open without migration (Phase 1 schema parity guarantees this).
- Install script copies `.app` to `/Applications/`, no SingletonLock equivalent needed (Tauri uses single-instance plugin).
- Docs updated.

---

## Strangler-Fig Invariant

After every commit on this migration: **the app must still launch and operate**. No phase leaves it broken.

- Phase 1–2: Rust code lives in `rust/` parallel to current Bun code. Zero runtime coupling. Bun stack unchanged.
- Phase 3: Tauri app added but only as alternate shell. Electron still ships.
- Phase 4: Dashboard chooses backend via flag. Both work. Default flips to IPC at phase end.
- Phase 5: CLI rewritten; old CLI deleted only after new one passes acceptance.
- Phase 6: Bun packages deleted in a single commit, only after Phase 5 ships.

---

## Cross-Phase Concerns

**Schema drift:** Phase 1 owns the canonical schema. Phases 2–6 must not invent new tables or columns without first writing migrations in the Rust crate. If a phase needs schema change, write the migration in `rust/crates/core/src/db/migrations.rs` and version-bump.

**Type drift:** `ts-rs` generation runs as part of `cargo build`. CI fails if generated `.ts` files differ from committed copies (`git diff --exit-code packages/dashboard/src/types/generated/`).

**Test fixtures:** Phase 2 needs recorded `claude --output-format stream-json` output. Capture these BEFORE starting Phase 2 (record from a real run on a tiny test repo). Store under `rust/crates/core/tests/fixtures/`.

**Tauri IPC permission model:** Each command goes in `tauri.conf.json` capabilities. Default-deny; explicitly allow the dashboard's origin. Document this in Phase 3 plan.

**DB path compatibility:** Rust must read/write `~/.glue-paste-dev/glue-paste-dev.db` (same path as Bun). Phase 1 acceptance includes opening an existing Bun-produced DB.

---

## Risks & Open Questions

1. **Stream-parser semantic fidelity.** Bun's runner does substring matching on rate-limit errors, partial-JSON parsing on stream-json, and special-cases tool-use payloads. Phase 2 must port these byte-exact or rate-limit detection regresses.

2. **Process tree kill on Windows.** Bun uses `taskkill /T /F /PID`. Rust port needs same behavior; verify `taskkill` available in target Windows envs.

3. **Tauri v2 vs v1.** Plan assumes Tauri 2 (current stable as of 2026-05). IPC permission model differs from v1; reference Tauri 2 docs only.

4. **Dashboard's `xterm` integration.** Currently renders plain text from execution output. Should not need changes — text still arrives via the event channel as strings.

5. **AI route in server.** `routes/ai.ts` calls external Anthropic API for title generation. Rust port needs `anthropic-sdk` equivalent — use `async-anthropic` crate or hand-rolled `reqwest`.

6. **Auto-update.** Electron has its own updater. Tauri has `tauri-plugin-updater`. Migration plan in Phase 6.

---

## Next Step

Execute **Phase 1** using `docs/superpowers/plans/2026-05-26-phase-1-rust-core-foundation.md`.

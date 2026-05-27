# Phase 4 (minimum viable subset) — IPC commands

**Realistic scope:** Wire the core kanban CRUD + execution streaming through Tauri IPC. Skip the full 50+ route surface; deliver enough for the dashboard to operate against the Rust core via `VITE_BACKEND=ipc`. Remaining endpoints stay on the http backend; Phase 4.5 (later session) ports the rest.

**Branch:** `feat/rust-migration-phase-4`. Base: post-Phase 3 `main`.

## Scope (in)

Rust side (`rust/crates/tauri-app/src/`):
- App state: shared `Arc<Mutex<Connection>>` initialized in `tauri::Builder::setup`
- Tauri commands:
  - `boards_list`, `boards_get`, `boards_create`, `boards_update`, `boards_delete`
  - `cards_list_for_board`, `cards_get_with_tags`, `cards_create`, `cards_update`, `cards_move`, `cards_delete`
  - `comments_list_for_card`, `comments_create`, `comments_clear`
  - `executions_list_for_card`
- Register all via `.invoke_handler(tauri::generate_handler![...])`

Dashboard side:
- `backends/ipc.ts`: implement the 4 namespaces (boards, cards, comments, executions) via `@tauri-apps/api/core::invoke`
- Other namespaces remain throwing
- Dashboard package.json: add `@tauri-apps/api` dep

## Out of scope (Phase 4.5)

- Queue + execution callbacks → Tauri events (the streaming flows)
- Config + AI + caffeinate + update + terminal + chat routes
- WebSocket broadcast equivalent (Tauri events)
- The actual SWITCH from http to ipc by default in Tauri builds

## Tasks

### Task 1: Add @tauri-apps/api to dashboard

```bash
cd packages/dashboard && bun add @tauri-apps/api
```

Commit: `chore(dashboard): add @tauri-apps/api dep for IPC`

### Task 2: Tauri app state + boards commands

- Create `rust/crates/tauri-app/src/state.rs` — AppState struct holding shared DB connection
- Create `rust/crates/tauri-app/src/commands/mod.rs` + `commands/boards.rs`
- Modify `lib.rs` to initialize state in setup + register handlers

Acceptance: `cargo check -p glue-paste-dev-tauri` clean.

Commit: `feat(tauri-app): app state + boards Tauri commands`

### Task 3: Cards + comments + executions commands

- `commands/cards.rs`, `commands/comments.rs`, `commands/executions.rs`
- Register

Commit: `feat(tauri-app): cards/comments/executions Tauri commands`

### Task 4: ipcBackend wires the 4 namespaces

- `backends/ipc.ts` rewrites the boards, cards, comments, executions namespaces to use `invoke()`
- Other namespaces stay throwing
- `cd packages/dashboard && bunx tsc -b && bunx vitest run` green

Commit: `feat(dashboard): ipcBackend wires boards/cards/comments/executions via invoke`

### Task 5: README + handoff notes

Document Phase 4 minimum-viable scope, deferred items, how to run Tauri in IPC mode for verification.

Commit: `docs: Phase 4 (minimum viable) scope + Phase 4.5 follow-ups`

---

## Phase 4.5 follow-ups (future session)

- Queue commands + Tauri event emission for execution streaming
- Remaining 14 route groups (config, ai, caffeinate, update, terminal, chat, etc.)
- WebSocket → Tauri events bridge (or equivalent abstraction)
- Switch Tauri build's default backend to ipc via `VITE_BACKEND=ipc` in build env

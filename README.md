# GluePasteDev

<img src="assets/image.jpg" alt="GluePasteDev" width="600" />

A visual Kanban board that turns your coding tasks into automated AI sessions. Add cards, hit play, and Claude CLI builds your features one by one.

## What it does

You create a board for a project, add cards describing what you want built, and GluePasteDev runs them sequentially through Claude Code. Each card goes through a plan phase, then an execution phase. If something fails, it retries once and stops. You can add comments to cards to give the AI feedback ("not what I expected, try X"), and the next run includes that context.

## Key features

- **Kanban dashboard** — 5-column board (Todo, Queued, In Progress, Done, Failed) with real-time WebSocket updates
- **Sequential execution** — Play a single card or hit Play All to run the whole board card by card
- **2-phase runs** — Each card gets a plan phase (Claude thinks), then an execute phase (Claude codes) with auto-permissions
- **Comment feedback loop** — User and AI comments on cards carry context between runs
- **Per-project config** — Model, budget, custom tags, instructions. Project settings override global defaults
- **Resilient daemon** — Background process with auto-restart on crash, exponential back-off, log file
- **Tag system** — Default tags (UX, design, backend, logic) plus custom tags per project

## Current status

**Alpha** — Core architecture is in place. The Kanban board, API, executor, CLI daemon, and comment system all work. Drag-and-drop reordering and the embedded terminal view (xterm.js) are next.

## Install (macOS)

```bash
bash scripts/build-and-install.sh
```

Builds the Tauri app from source and copies it to `/Applications/GluePaste.app`.

## Develop

```bash
# Hot-reload Tauri + dashboard
cd rust/crates/tauri-app && cargo tauri dev

# Or run the dashboard alone (no native window)
cd packages/dashboard && bun run dev
```

## Build a release

```bash
bash scripts/build-tauri.sh
# Output: rust/target/release/bundle/macos/GluePaste.app
```

## Test

```bash
cd packages/dashboard && bunx vitest run
cd rust && cargo test --workspace
```

## Usage

```bash
# Start the daemon (opens browser automatically)
glue-paste-dev start

# Check status
glue-paste-dev status

# View logs (follow mode)
glue-paste-dev logs -f

# Open dashboard (starts daemon if not running)
glue-paste-dev open

# Restart
glue-paste-dev restart

# Stop
glue-paste-dev stop

# Update to latest version
glue-paste-dev update
```

The dashboard runs at **http://localhost:4242**.

## How it works

1. Create a board — give it a name and point it at a project directory
2. Add cards — title, description, tags
3. Click Play on a card (or Play All for the whole board)
4. GluePasteDev spawns `claude -p` in your project directory with a prompt built from the card
5. Plan phase runs first (Claude analyzes the task), then execute phase (Claude writes code with `--dangerously-skip-permissions`)
6. Results stream to the dashboard in real-time via WebSocket
7. System auto-adds a comment with the result. If it failed, add your feedback and run again.

## Architecture

| Package | What |
|---------|------|
| `packages/dashboard` | React 19 + Tailwind v4 + shadcn-style UI |
| `rust/crates/core` | Schemas, SQLite DB, executor, config manager |
| `rust/crates/tauri-app` | Tauri 2 window, IPC commands, event emission |
| `rust/crates/cli` | `glue-paste-dev` daemon commands |

Data lives in `~/.glue-paste-dev/` (SQLite database, PID file, logs).

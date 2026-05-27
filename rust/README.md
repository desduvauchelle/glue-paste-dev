# Rust backend (migration in progress)

`core` crate ships:
- **Phase 1** — DB (rusqlite + WAL/mmap), schema + migrations, types with ts-rs generation
- **Phase 2** — Executor port: fresh_env, rate_limit, git_errors, process_cleanup, stream_parser, extract_report, cli_adapter, prompt, execution_logger, generate_title, chat, runner, queue

See `docs/superpowers/plans/2026-05-26-rust-tauri-migration-roadmap.md` for the full migration plan (Phases 3–6: Tauri shell, IPC commands, CLI rewrite, retire Bun).

## Build

```bash
cd rust
cargo build --workspace
```

## Test

```bash
cd rust
cargo test --workspace
```

## Regenerate TypeScript types

`cargo test` writes `.ts` files into `../packages/dashboard/src/types/generated/`.
Commit any diffs.

## DB compatibility

Crate opens the existing user database at `~/.glue-paste-dev/glue-paste-dev.db`
with the same pragmas as Bun (WAL, mmap, foreign_keys ON). Schema parity is
guaranteed by `tests/bun_parity.rs`.

## Phase 2 module map

| Rust path | Bun source | Purpose |
|---|---|---|
| `executor/fresh_env.rs` | `executor/fresh-env.ts` | login-shell PATH + OAuth token resolution (5s cache) |
| `executor/rate_limit.rs` | `executor/rate-limit.ts` | regex-based rate-limit + overloaded detection |
| `executor/git_errors.rs` | `executor/git-errors.ts` | git stderr classification (9 categories) |
| `executor/process_cleanup.rs` | `executor/process-cleanup.ts` | process tree kill (TERM → KILL) |
| `executor/stream_parser.rs` | `executor/stream-parser.ts` | Claude stream-json line parser |
| `executor/extract_report.rs` | `executor/extract-report.ts` | plan/execute report extraction via haiku |
| `executor/cli_adapter.rs` | `executor/cli-adapter.ts` | argv builder for 6 providers |
| `executor/prompt.rs` | `executor/prompt.ts` | task prompt assembly |
| `executor/execution_logger.rs` | `executor/execution-logger.ts` | append-only per-execution log files |
| `executor/generate_title.rs` | `executor/generate-title.ts` | async title generator via haiku |
| `executor/chat.rs` | `executor/chat.ts` | async chat subprocess with comment lifecycle |
| `executor/runner.rs` | `executor/runner.ts` | 2-phase plan+execute, git capture, callbacks |
| `executor/queue.rs` | `executor/queue.ts` | per-board slot manager |

## Phase 2 known follow-ups (before Phase 4 wires this in)

- Per-card config overrides (`applyCardOverrides`) — port from Bun's config manager
- Rate-limit auto-resume timer — currently pauses; server must re-resume
- `card_files` threading from server through `start_queue` / `execute_single_card`
- PTY runner / `setInteractiveHub` — terminal-IS-the-run interactive path deferred
- `cleanupStaleAttachments`, `enforceAttachmentCap` — attachment cleanup not yet ported

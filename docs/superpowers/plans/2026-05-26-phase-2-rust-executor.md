# Phase 2 — Rust Executor Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Port `packages/core/src/executor/*` from Bun TypeScript to Rust in `rust/crates/core/src/executor/`. Result: a Rust executor crate-module that can spawn AI CLI subprocesses, stream their output, parse stream-json, extract reports, manage a queue, and kill process trees. Standalone — not wired to Bun server yet (Phase 4 wires).

**Architecture:** New `executor` module in the existing `glue-paste-dev-core` crate. Uses `tokio` for async + subprocess streaming. Each Bun TS module gets a Rust counterpart with the same public interface conceptually (free functions, not classes). The terminal-IS-the-run PTY path is intentionally deferred to a follow-up — Phase 2 ports the headless executor only.

**Tech Stack:** Tokio 1.x, reqwest (for generate-title's Anthropic call), regex 1.x, anyhow 1.x (or thiserror, already in workspace), tracing 0.1 for structured logging (optional — defer to Phase 4 if it pulls too much).

**Pre-flight reading for each implementer subagent:**
- The Bun TS source for the module being ported (`packages/core/src/executor/<module>.ts`)
- The associated `__tests__/executor/<module>.test.ts` for behavior specs
- Phase 1's `rust/crates/core/src/db/*.rs` for established Rust patterns

**Branch:** `feat/rust-migration-phase-2`. Base: `main` (which has Phase 1 + proof-of-work + phase3 merged).

**Working directory:** `/Users/denisduvauchelle/Documents/code/glue-paste-dev`. All paths relative.

**Strangler-fig invariant:** The Bun executor (`packages/core/src/executor/*.ts`) is **not modified**. Rust ports live in parallel. App keeps using Bun executor throughout this phase.

---

## Setup

### Task 0: Add executor dependencies to core crate

**Files:**
- Modify: `rust/Cargo.toml` (workspace deps)
- Modify: `rust/crates/core/Cargo.toml` (crate deps)
- Modify: `rust/crates/core/src/lib.rs` (add `pub mod executor`)
- Create: `rust/crates/core/src/executor/mod.rs` (empty module declarations, populated by later tasks)

- [ ] **Step 1: Add to workspace `rust/Cargo.toml` under `[workspace.dependencies]`**

```toml
tokio = { version = "1.40", features = ["full"] }
regex = "1.10"
reqwest = { version = "0.12", features = ["json", "rustls-tls"], default-features = false }
async-trait = "0.1"
futures = "0.3"
```

- [ ] **Step 2: Add to crate `rust/crates/core/Cargo.toml` under `[dependencies]`**

```toml
tokio = { workspace = true }
regex = { workspace = true }
reqwest = { workspace = true }
async-trait = { workspace = true }
futures = { workspace = true }
```

- [ ] **Step 3: Module skeleton**

Append to `rust/crates/core/src/lib.rs`:
```rust
pub mod executor;
```

Create `rust/crates/core/src/executor/mod.rs`:
```rust
// Modules populated by Phase 2 tasks.
```

- [ ] **Step 4: Verify build**

```bash
cd rust && cargo build -p glue-paste-dev-core
```

Expect: clean build (deps download takes 1-3 min).

- [ ] **Step 5: Commit**

```bash
git add rust/Cargo.toml rust/crates/core/Cargo.toml rust/crates/core/src/lib.rs rust/crates/core/src/executor/mod.rs
git commit -m "feat(rust-core): add executor module scaffolding"
```

---

## Module Port Tasks

Each task ports one Bun TS module to a Rust counterpart. **Each task:**

1. Reads the Bun source (`packages/core/src/executor/<module>.ts`) plus test file (`packages/core/src/__tests__/executor/<module>.test.ts` or co-located `<module>.test.ts`).
2. Designs the Rust API (idiomatic — free functions, types per existing pattern).
3. Writes Rust code under `rust/crates/core/src/executor/<module>.rs` + adds `pub mod <module>;` to `executor/mod.rs`.
4. Writes inline `#[cfg(test)] mod tests` mirroring Bun test behaviors.
5. Runs `cd rust && cargo test -p glue-paste-dev-core executor::<module>` — green.
6. Runs full suite `cd rust && cargo test -p glue-paste-dev-core` — green.
7. Commits as `feat(rust-core): port executor <module>`.

**Dependency order — do not change.** Earlier modules cannot depend on later ones.

### Task 1: `fresh_env` (tiny)

Port `packages/core/src/executor/fresh-env.ts`. Returns a `HashMap<String, String>` of env vars with sensitive ones (API keys) stripped. Match Bun's exact filter list. ~30 lines of Rust + 1-2 tests.

**Acceptance:**
- `pub fn build_fresh_env() -> HashMap<String, String>` returns process env minus the blocklisted keys
- Test verifies blocked keys (`ANTHROPIC_API_KEY`, etc.) are absent and at least one normal key (`PATH`) is present

### Task 2: `rate_limit`

Port `packages/core/src/executor/rate-limit.ts`. Pattern-match output for rate-limit errors. Returns enum result.

**Acceptance:**
- `pub fn detect_rate_limit(output: &str) -> Option<RateLimitInfo>` where `RateLimitInfo` carries provider + retry_after if extractable
- Tests: all sample strings from Bun test file produce same classifications

### Task 3: `git_errors`

Port `packages/core/src/executor/git-errors.ts`. Pure pattern recognition over git stderr.

**Acceptance:**
- `pub fn classify_git_error(stderr: &str) -> GitErrorKind` with the same variants as Bun
- Tests cover each variant

### Task 4: `process_cleanup`

Port `packages/core/src/executor/process-cleanup.ts`. Kill a process tree by PID. Cross-platform (macOS/Linux: `kill -TERM` then `kill -KILL`; Windows: `taskkill /T /F /PID`).

**Acceptance:**
- `pub fn kill_process_tree(pid: i32) -> Result<()>` works on current platform
- Cross-platform compile (`cfg(target_os)`)
- Test that spawns a `sleep 60` child, calls `kill_process_tree`, asserts child gone within 1s

### Task 5: `stream_parser` 🔴 RISK CENTER

Port `packages/core/src/executor/stream-parser.ts`. Parses Claude's `--output-format stream-json` lines.

**Critical:** This must produce byte-exact equivalent classifications to Bun. Read the test file thoroughly. Record real stream-json output if needed (run `claude -p "say hi" --output-format stream-json --verbose` and pipe to a fixture file under `rust/crates/core/tests/fixtures/stream-json-sample.jsonl`).

**Acceptance:**
- `pub fn parse_stream_line(line: &str) -> Option<ParsedLine>` returns `{ kind: text|tool_use|result|other, content: String, cost_usd: Option<f64> }`
- All Bun test cases pass in Rust
- A captured real-world fixture parses without errors and totals correct cost

### Task 6: `extract_report` 🔴 RISK CENTER

Port `packages/core/src/executor/extract-report.ts`. Extracts `plan_summary`, `completion_summary`, `blocker`, and `criteria` results from a full output blob.

**Acceptance:**
- `pub fn extract_plan_report(output: &str) -> PlanReport` and `extract_execute_report(output: &str) -> ExecuteReport`
- All Bun test cases pass

### Task 7: `cli_adapter`

Port `packages/core/src/executor/cli-adapter.ts`. Builds argv vectors for each provider (claude, gemini, codex, aider, copilot, custom).

**Acceptance:**
- `pub fn build_cli_command(config: &Config, prompt: &str, session_id: &str, phase: ExecutionPhase, resume: bool) -> CliCommand`
- `CliCommand { args: Vec<String>, supports_stream_json: bool, supports_session: bool }`
- Tests for each provider cover the same scenarios as Bun

### Task 8: `prompt`

Port `packages/core/src/executor/prompt.ts`. Builds the prompt strings sent to the CLI.

**Acceptance:**
- `pub fn build_prompt(input: &BuildPromptInput) -> String`
- Test outputs match Bun byte-for-byte for the cases in Bun test file

### Task 9: `execution_logger`

Port `packages/core/src/executor/execution-logger.ts`. Appends to log files under `~/.glue-paste-dev/executions/<execution_id>.log`.

**Acceptance:**
- `pub fn open_execution_log(execution_id: &str) -> Result<File>` and append helpers
- Test using tempdir: write, read back, verify content

### Task 10: `generate_title`

Port `packages/core/src/executor/generate-title.ts`. Calls Anthropic API via HTTP (`reqwest`).

**Acceptance:**
- `pub async fn generate_title(description: &str, api_key: &str, model: &str) -> Result<String>`
- Test: mock the HTTP endpoint with a tiny axum or wiremock; assert payload + parsed response

### Task 11: `chat`

Port `packages/core/src/executor/chat.ts`. Spawns a Claude subprocess for interactive chat in a card session. Reuses `cli_adapter` + `stream_parser`.

**Acceptance:**
- `pub async fn run_chat(...)` returns a stream of message events
- Test: stub subprocess via shell `echo` with a fake JSON stream; assert events parsed

### Task 12: `runner` 🔴 BIGGEST

Port `packages/core/src/executor/runner.ts`. Coordinates two-phase execution (plan + execute), spawns subprocess, streams stdout, calls callbacks, captures git changes + new commits, completes the execution record. Uses `tokio::process::Command`. Replaces `Bun.spawn` semantics.

**Acceptance:**
- `pub async fn run_card(db: &Connection, card: &CardWithTags, board: &Board, comments: &[Comment], config: &Config, callbacks: impl RunnerCallbacks, options: RunOptions) -> Result<RunResult>`
- Integration test using a stub CLI (a shell script that prints JSON lines + exits) that drives runner end-to-end against an in-memory DB; assert DB state changes match Bun's

### Task 13: `queue`

Port `packages/core/src/executor/queue.ts`. Manages per-board card queue, slot-filling, pause/resume, concurrency.

**Acceptance:**
- `pub async fn start_queue(...)`, `stop_queue`, `pause_queue`, `resume_queue`, `get_queue_state`, `notify_new_card`
- Tests mirror Bun queue test files (queue-auto-start, queue-concurrency, queue-stop-card, queue-skips-todo, queue-skips-human, queue-logic, queue-execution)

---

## Cross-cutting

### Task 14: Re-export executor public API

**Files:**
- Modify: `rust/crates/core/src/executor/mod.rs`

Re-export with `pub use module::*` so callers see `glue_paste_dev_core::executor::{run_card, start_queue, ...}`.

- [ ] Run full suite + commit `feat(rust-core): re-export executor public API`

### Task 15: Update `ts-rs` bindings for any new types

Several Phase 2 modules introduce new types (`RunResult`, `QueueState`, `ParsedLine`, etc.). If any need to cross the IPC boundary in Phase 4, add `#[derive(TS)]` + `#[ts(export, ...)]` and commit generated `.ts` files. If they're purely internal, skip.

**Acceptance:**
- Decide per-type whether it's IPC-boundary
- For boundary types: TS files appear in `packages/dashboard/src/types/generated/`, no diff after `cargo test`

### Task 16: README + phase summary

Update `rust/README.md` adding executor module overview + how to run executor tests.

---

## Self-Review Checklist

Before final commit on Phase 2 branch:
- [ ] Every Bun module under `packages/core/src/executor/*.ts` has a Rust counterpart (skipping `pty-runner.ts` — deferred)
- [ ] `cargo test -p glue-paste-dev-core` green
- [ ] `cargo clippy -p glue-paste-dev-core` no warnings
- [ ] No code in `packages/core/src/executor/*.ts` was modified
- [ ] Generated TS in dashboard `types/generated/` matches `cargo test` output (CI sync check passes)
- [ ] Branch commits follow `feat(rust-core): port executor <module>` pattern

---

## Execution Handoff

Per project CLAUDE.md: auto-select **Subagent-Driven Development**.

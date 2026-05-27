# CLAUDE.md — glue-paste-dev

## Project Structure

Monorepo with one TypeScript package and three Rust crates:

- `packages/dashboard` — React 19 frontend (Vite + Tailwind v4). The only TypeScript package.
- `rust/crates/core` — shared types, schemas, DB layer, executor logic.
- `rust/crates/tauri-app` — Tauri 2 host: window, IPC commands, event emission.
- `rust/crates/cli` — `glue-paste-dev` CLI (start/stop/status/logs/add/update/uninstall).

## TypeScript — Run After Every Change

After writing or editing code, always run a type check before considering the task done.

| Package | Type check command |
|---|---|
| `packages/dashboard` | `cd packages/dashboard && bunx tsc -b` |
| `rust/crates/core` | `cd rust && cargo check -p glue-paste-dev-core` |
| `rust/crates/tauri-app` | `cd rust && cargo check -p glue-paste-dev-tauri` |
| `rust/crates/cli` | `cd rust && cargo check -p glue-paste-dev-cli` |

Fix all type errors before finishing. Do not leave `// @ts-ignore` or `any` casts unless the user explicitly approves them.

## Testing

### Testing stack

| Package | Runner | Libraries |
|---|---|---|
| `packages/dashboard` | Vitest (`vitest run`) | Vitest + @testing-library/react + @testing-library/jest-dom + jsdom |
| `rust/crates/core` | `cargo test` | Bun parity fixtures |
| `rust/crates/tauri-app` | `cargo test` | Tauri test utils |

### When to write tests

- **New business logic** in `rust/crates/core`: write a Rust unit test alongside the implementation.
- **New Tauri commands**: write an integration test in `rust/crates/tauri-app/tests/`.
- **New React components or hooks** in `dashboard` with non-trivial behaviour: write a component test with `@testing-library/react`.
- **Bug fixes**: add a regression test that fails before the fix and passes after.

### Running tests

```bash
# Per package
cd packages/dashboard && bunx vitest run
cd rust && cargo test --workspace
```

Always run the relevant package tests after making changes and confirm they pass before finishing.

## Planning

When in plan mode, always write plans to the designated plan file path provided by the system, not to `docs/superpowers/plans/`.

## General Guidelines

- Keep solutions minimal — only change what was asked or is clearly necessary.
- Do not add error handling, comments, or abstractions beyond what the task requires.
- Prefer editing existing files over creating new ones.
- Do not commit unless explicitly asked.

## Workflow Automation

When superpowers skills present execution choices, auto-select and proceed instead of asking:

- **writing-plans "Execution Handoff"**: Always choose **Subagent-Driven Development**. Invoke `superpowers:subagent-driven-development` immediately after saving the plan. Do not ask which approach.
- **finishing-a-development-branch "Present Options"**: Always choose **Option 2: Push and create a Pull Request**. Do not present the 4 options — just push the branch and create the PR. Do not ask which option.
- **executing-plans completion**: When all tasks are done, proceed directly to `superpowers:finishing-a-development-branch` without asking.

These directives override the corresponding skill sections. If a specific conversation requires a different choice, the user will say so explicitly.

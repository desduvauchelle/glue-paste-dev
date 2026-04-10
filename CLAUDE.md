# CLAUDE.md — glue-paste-dev

## Project Structure

Monorepo with four packages:

- `packages/core` — shared types, schemas (Zod), DB layer, executor logic. Runtime: Bun.
- `packages/server` — HTTP API built with Hono. Runtime: Bun.
- `packages/dashboard` — React 19 frontend (Vite + Tailwind v4).
- `packages/cli` — CLI entry point. Runtime: Bun.

## TypeScript — Run After Every Change

This is a TypeScript monorepo. After writing or editing code, always run a type check before considering the task done.

| Package | Type check command |
|---|---|
| `packages/core` | `cd packages/core && bunx tsc --noEmit` |
| `packages/server` | `cd packages/server && bunx tsc --noEmit` |
| `packages/dashboard` | `cd packages/dashboard && bunx tsc -b` |
| `packages/cli` | `cd packages/cli && bunx tsc --noEmit` |

Fix all type errors before finishing. Do not leave `// @ts-ignore` or `any` casts unless the user explicitly approves them.

## Testing

### Testing stack

| Package | Runner | Libraries |
|---|---|---|
| `packages/core` | Bun test (`bun test`) | Built-in Bun assertions |
| `packages/server` | Vitest (`vitest run`) | Vitest + Hono test client |
| `packages/dashboard` | Vitest (`vitest run`) | Vitest + @testing-library/react + @testing-library/jest-dom + jsdom |

### When to write tests

- **New business logic** in `core` (schemas, DB helpers, executor): write a unit test alongside the implementation.
- **New API routes** in `server`: write an integration test using Hono's test utilities.
- **New React components or hooks** in `dashboard` with non-trivial behaviour: write a component test with `@testing-library/react`.
- **Bug fixes**: add a regression test that fails before the fix and passes after.

### Running tests

```bash
# Run all tests from the repo root
bun run test          # if a root-level test script exists

# Per package
cd packages/core && bun test
cd packages/server && bunx vitest run
cd packages/dashboard && bunx vitest run
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

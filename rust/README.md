# Rust backend (migration in progress)

Phase 1 ships the `core` crate (DB + types). See
`docs/superpowers/plans/2026-05-26-rust-tauri-migration-roadmap.md` for the
full migration plan.

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

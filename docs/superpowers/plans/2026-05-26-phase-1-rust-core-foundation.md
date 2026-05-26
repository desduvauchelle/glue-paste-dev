# Phase 1 — Rust Core Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port `packages/core/src/db/*` (SQLite schema + CRUD) and `packages/core/src/types/*` to a Rust `core` crate with TypeScript type generation via `ts-rs`. Result: a standalone Rust crate that opens existing Bun-created databases and is byte-for-byte schema-compatible.

**Architecture:** New `rust/` workspace with one `core` crate (more crates added in later phases). `rusqlite` for SQLite (sync, same as Bun's behavior), `serde` for serialization, `ts-rs` for TypeScript type emission. No async needed in Phase 1 — DB layer is sync, matching the current Bun design.

**Tech Stack:** Rust 1.78+ (edition 2021), `rusqlite` 0.31 with `bundled` feature, `serde` + `serde_json`, `ts-rs` 8.x, `tempfile` for tests, `chrono` for timestamps. Bun unchanged.

**Scope boundary:** Phase 1 ports ONLY DB + types. It does NOT port: executor, runner, stream-parser, CLI adapter, prompts, config manager, schemas (Zod equivalents — Phase 2). The crate compiles standalone and has tests; nothing wired to Tauri or the dashboard yet.

**Pre-flight reading for the implementer:**
- `packages/core/src/db/schema.ts` — the canonical schema, including all `ALTER TABLE` migrations.
- `packages/core/src/db/boards.ts`, `cards.ts`, `comments.ts`, `executions.ts`, `criteria.ts`, `commits.ts` — CRUD signatures to mirror.
- `packages/core/src/db/connection.ts` — pragma settings (`journal_mode=WAL`, `foreign_keys=ON`, `cache_size=-2000`, `mmap_size=64000000`) must be replicated.
- `packages/core/src/types/index.ts` — TypeScript type shapes to emit via `ts-rs`.

**Working directory throughout:** repo root `/Users/denisduvauchelle/Documents/code/glue-paste-dev`. All file paths below are relative to it.

---

### Task 1: Scaffold Rust workspace

**Files:**
- Create: `rust/Cargo.toml`
- Create: `rust/.gitignore`
- Modify: `.gitignore` (root) — add `rust/target/`

- [ ] **Step 1: Create workspace manifest**

Write `rust/Cargo.toml`:
```toml
[workspace]
resolver = "2"
members = ["crates/core"]

[workspace.package]
version = "0.1.0"
edition = "2021"
license = "MIT"
repository = "https://github.com/glue-paste-dev/glue-paste-dev"

[workspace.dependencies]
rusqlite = { version = "0.31", features = ["bundled", "chrono"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
chrono = { version = "0.4", features = ["serde"] }
ts-rs = "8"
thiserror = "1"
uuid = { version = "1", features = ["v4"] }
dirs = "5"
tempfile = "3"
```

- [ ] **Step 2: Create Rust gitignore**

Write `rust/.gitignore`:
```
target/
Cargo.lock
*.db
*.db-wal
*.db-shm
```

- [ ] **Step 3: Add Rust target to root .gitignore**

Append to `.gitignore`:
```
rust/target/
```

- [ ] **Step 4: Verify workspace parses**

Run: `cd rust && cargo check`
Expected: error about no members compiled yet (no crates exist — that's fine). Actually `cargo check` with empty member dir errors — skip this step until Task 2.

- [ ] **Step 5: Commit**

```bash
git add rust/Cargo.toml rust/.gitignore .gitignore
git commit -m "feat(rust): scaffold workspace for backend migration"
```

---

### Task 2: Scaffold `core` crate

**Files:**
- Create: `rust/crates/core/Cargo.toml`
- Create: `rust/crates/core/src/lib.rs`

- [ ] **Step 1: Write crate manifest**

Write `rust/crates/core/Cargo.toml`:
```toml
[package]
name = "glue-paste-dev-core"
version.workspace = true
edition.workspace = true
license.workspace = true
repository.workspace = true

[dependencies]
rusqlite = { workspace = true }
serde = { workspace = true }
serde_json = { workspace = true }
chrono = { workspace = true }
ts-rs = { workspace = true }
thiserror = { workspace = true }
uuid = { workspace = true }
dirs = { workspace = true }

[dev-dependencies]
tempfile = { workspace = true }
```

- [ ] **Step 2: Write minimal lib.rs**

Write `rust/crates/core/src/lib.rs`:
```rust
pub mod db;
pub mod types;
pub mod error;

pub use error::{Error, Result};
```

- [ ] **Step 3: Write placeholder modules so it compiles**

Write `rust/crates/core/src/error.rs`:
```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("not found")]
    NotFound,
}

pub type Result<T> = std::result::Result<T, Error>;
```

Write `rust/crates/core/src/db/mod.rs`:
```rust
pub mod connection;
pub mod schema;
```

Write `rust/crates/core/src/db/connection.rs`:
```rust
// Populated in Task 3.
```

Write `rust/crates/core/src/db/schema.rs`:
```rust
// Populated in Task 4.
```

Write `rust/crates/core/src/types/mod.rs`:
```rust
// Populated in Task 14.
```

- [ ] **Step 4: Verify it builds**

Run: `cd rust && cargo build -p glue-paste-dev-core`
Expected: builds cleanly, possibly with `unused` warnings (acceptable for now).

- [ ] **Step 5: Commit**

```bash
git add rust/crates/core
git commit -m "feat(rust-core): scaffold crate with module layout"
```

---

### Task 3: DB connection module (open + pragmas + path)

**Files:**
- Modify: `rust/crates/core/src/db/connection.rs`
- Test: `rust/crates/core/src/db/connection.rs` (inline `#[cfg(test)]`)

Mirrors `packages/core/src/db/connection.ts`. Default path: `~/.glue-paste-dev/glue-paste-dev.db`. Pragmas: WAL, foreign keys, cache_size -2000, mmap 64MB. Provide `open_default()`, `open_at(path)`, `open_memory()`, `wal_checkpoint(conn)`.

- [ ] **Step 1: Write failing test for `open_memory` + pragma readback**

Replace `rust/crates/core/src/db/connection.rs` with:
```rust
use rusqlite::Connection;
use std::path::{Path, PathBuf};

use crate::Result;

const DEFAULT_DIR: &str = ".glue-paste-dev";
const DEFAULT_FILE: &str = "glue-paste-dev.db";

pub fn default_db_path() -> PathBuf {
    let home = dirs::home_dir().expect("home dir resolvable");
    home.join(DEFAULT_DIR).join(DEFAULT_FILE)
}

pub fn open_at(path: impl AsRef<Path>) -> Result<Connection> {
    if let Some(parent) = path.as_ref().parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(path.as_ref())?;
    apply_pragmas(&conn)?;
    crate::db::schema::init(&conn)?;
    Ok(conn)
}

pub fn open_memory() -> Result<Connection> {
    let conn = Connection::open_in_memory()?;
    apply_pragmas(&conn)?;
    crate::db::schema::init(&conn)?;
    Ok(conn)
}

pub fn open_default() -> Result<Connection> {
    open_at(default_db_path())
}

pub fn wal_checkpoint(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA wal_checkpoint(PASSIVE)")?;
    Ok(())
}

fn apply_pragmas(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         PRAGMA cache_size = -2000;
         PRAGMA mmap_size = 64000000;",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_memory_applies_pragmas() {
        let conn = open_memory().expect("open");
        let fk: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
            .unwrap();
        assert_eq!(fk, 1, "foreign keys must be ON");
    }

    #[test]
    fn open_at_creates_parent_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("nested/dir/test.db");
        let _conn = open_at(&path).expect("open");
        assert!(path.exists());
    }
}
```

- [ ] **Step 2: Run and verify tests fail because schema::init is empty**

Run: `cd rust && cargo test -p glue-paste-dev-core db::connection`
Expected: passes (schema::init is empty, but pragmas + path logic work). If failing on schema::init reference, also temporarily comment out `crate::db::schema::init(&conn)?;` until Task 4 — but cleaner to proceed to Task 4 first and not commit Task 3 alone.

Actually: leave the `schema::init` call in. Tests should pass once we write a no-op `init` returning `Ok(())` in Task 4. Skip the run here; do it at the end of Task 4.

- [ ] **Step 3: Commit**

```bash
git add rust/crates/core/src/db/connection.rs
git commit -m "feat(rust-core): db connection with WAL + mmap pragmas"
```

---

### Task 4: DB schema module — full port with migrations

**Files:**
- Modify: `rust/crates/core/src/db/schema.rs`
- Test: `rust/crates/core/src/db/schema.rs` (inline tests)

Port `packages/core/src/db/schema.ts` — the full `initSchema` function. The Bun version embeds the canonical schema PLUS 30+ `ALTER TABLE` migration blocks for legacy databases. Rust port keeps the same approach: one `init()` entry, embedded SQL string for fresh DBs, then migration blocks that silently swallow "duplicate column" errors via `Result::ok()`.

- [ ] **Step 1: Write the failing schema test first**

Append to `rust/crates/core/src/db/schema.rs`:
```rust
use rusqlite::Connection;
use crate::Result;

pub fn init(conn: &Connection) -> Result<()> {
    conn.execute_batch(SCHEMA_SQL)?;
    apply_migrations(conn);
    Ok(())
}

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS boards (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    directory TEXT NOT NULL,
    session_id TEXT,
    color TEXT DEFAULT NULL,
    scratchpad TEXT NOT NULL DEFAULT '',
    slug TEXT DEFAULT NULL,
    github_url TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','queued','in-progress','done','failed')),
    position INTEGER NOT NULL DEFAULT 0,
    blocking INTEGER NOT NULL DEFAULT 0,
    thinking_level TEXT DEFAULT NULL,
    plan_mode INTEGER DEFAULT NULL,
    plan_thinking TEXT DEFAULT NULL,
    execute_thinking TEXT DEFAULT NULL,
    auto_commit INTEGER DEFAULT NULL,
    auto_push INTEGER DEFAULT NULL,
    assignee TEXT NOT NULL DEFAULT 'ai',
    cli_provider TEXT DEFAULT NULL,
    cli_custom_command TEXT DEFAULT NULL,
    branch_mode TEXT DEFAULT NULL,
    branch_name TEXT DEFAULT NULL,
    plan_summary TEXT DEFAULT NULL,
    completion_summary TEXT DEFAULT NULL,
    blocker TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS card_tags (
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (card_id, tag)
);

CREATE TABLE IF NOT EXISTS executions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    session_id TEXT,
    phase TEXT NOT NULL DEFAULT 'plan' CHECK(phase IN ('plan','execute')),
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','success','failed','cancelled')),
    output TEXT NOT NULL DEFAULT '',
    cost_usd REAL NOT NULL DEFAULT 0,
    exit_code INTEGER,
    retry_count INTEGER NOT NULL DEFAULT 0,
    pid INTEGER,
    files_changed TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    author TEXT NOT NULL CHECK(author IN ('user','system','ai')),
    content TEXT NOT NULL,
    execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    cli_provider TEXT DEFAULT 'claude',
    cli_custom_command TEXT DEFAULT '',
    model TEXT DEFAULT 'claude-opus-4-6',
    max_budget_usd REAL DEFAULT 10.0,
    plan_mode INTEGER DEFAULT 1,
    thinking_level TEXT DEFAULT 'smart',
    custom_tags TEXT DEFAULT '[]',
    custom_instructions TEXT DEFAULT '',
    plan_thinking TEXT DEFAULT 'smart',
    execute_thinking TEXT DEFAULT 'smart',
    auto_commit INTEGER DEFAULT 0,
    plan_model TEXT DEFAULT '',
    execute_model TEXT DEFAULT '',
    auto_push INTEGER DEFAULT 0,
    branch_mode TEXT DEFAULT 'current',
    branch_name TEXT DEFAULT '',
    max_concurrent_cards INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS card_files (
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    PRIMARY KEY (card_id, file_path)
);

CREATE TABLE IF NOT EXISTS card_commits (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
    sha TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    author_name TEXT NOT NULL DEFAULT '',
    author_email TEXT NOT NULL DEFAULT '',
    files_changed TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS card_criteria (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','pass','fail')),
    source TEXT NOT NULL DEFAULT 'ai' CHECK(source IN ('ai','user')),
    evidence TEXT DEFAULT NULL,
    execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cards_board_id ON cards(board_id);
CREATE INDEX IF NOT EXISTS idx_cards_status ON cards(status);
CREATE INDEX IF NOT EXISTS idx_comments_card_id ON comments(card_id);
CREATE INDEX IF NOT EXISTS idx_executions_card_id ON executions(card_id);
CREATE INDEX IF NOT EXISTS idx_card_files_card_id ON card_files(card_id);
CREATE INDEX IF NOT EXISTS idx_card_commits_card_id ON card_commits(card_id);
CREATE INDEX IF NOT EXISTS idx_card_criteria_card_id ON card_criteria(card_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_boards_slug ON boards(slug) WHERE slug IS NOT NULL;

INSERT OR IGNORE INTO config (key) VALUES ('global');
"#;

/// Apply legacy migrations. Each ALTER TABLE silently no-ops if the column
/// already exists. This matches `packages/core/src/db/schema.ts` which uses
/// try/catch around each migration step.
fn apply_migrations(conn: &Connection) {
    let migrations: &[&str] = &[
        "ALTER TABLE cards ADD COLUMN blocking INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE cards ADD COLUMN thinking_level TEXT DEFAULT NULL",
        "ALTER TABLE cards ADD COLUMN plan_mode INTEGER DEFAULT NULL",
        "ALTER TABLE config ADD COLUMN thinking_level TEXT NOT NULL DEFAULT 'smart'",
        "ALTER TABLE config ADD COLUMN cli_provider TEXT NOT NULL DEFAULT 'claude'",
        "ALTER TABLE config ADD COLUMN cli_custom_command TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE boards ADD COLUMN color TEXT DEFAULT NULL",
        "ALTER TABLE cards ADD COLUMN plan_thinking TEXT DEFAULT NULL",
        "ALTER TABLE cards ADD COLUMN execute_thinking TEXT DEFAULT NULL",
        "ALTER TABLE config ADD COLUMN plan_thinking TEXT DEFAULT 'smart'",
        "ALTER TABLE config ADD COLUMN execute_thinking TEXT NOT NULL DEFAULT 'smart'",
        "ALTER TABLE config ADD COLUMN auto_commit INTEGER NOT NULL DEFAULT 1",
        "ALTER TABLE cards ADD COLUMN auto_commit INTEGER DEFAULT NULL",
        "ALTER TABLE config ADD COLUMN plan_model TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE config ADD COLUMN execute_model TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE config ADD COLUMN auto_push INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE cards ADD COLUMN auto_push INTEGER DEFAULT NULL",
        "ALTER TABLE executions ADD COLUMN files_changed TEXT DEFAULT NULL",
        "ALTER TABLE cards ADD COLUMN assignee TEXT NOT NULL DEFAULT 'ai'",
        "ALTER TABLE boards ADD COLUMN scratchpad TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE boards ADD COLUMN slug TEXT DEFAULT NULL",
        "ALTER TABLE boards ADD COLUMN github_url TEXT DEFAULT NULL",
        "ALTER TABLE config ADD COLUMN branch_mode TEXT DEFAULT 'current'",
        "ALTER TABLE config ADD COLUMN branch_name TEXT DEFAULT ''",
        "ALTER TABLE config ADD COLUMN max_concurrent_cards INTEGER DEFAULT 1",
        "ALTER TABLE cards ADD COLUMN cli_provider TEXT DEFAULT NULL",
        "ALTER TABLE cards ADD COLUMN cli_custom_command TEXT DEFAULT NULL",
        "ALTER TABLE cards ADD COLUMN branch_mode TEXT DEFAULT NULL",
        "ALTER TABLE cards ADD COLUMN branch_name TEXT DEFAULT NULL",
        "ALTER TABLE cards ADD COLUMN plan_summary TEXT DEFAULT NULL",
        "ALTER TABLE cards ADD COLUMN completion_summary TEXT DEFAULT NULL",
        "ALTER TABLE cards ADD COLUMN blocker TEXT DEFAULT NULL",
    ];
    for sql in migrations {
        let _ = conn.execute(sql, []);
        // Errors are expected when the column already exists; ignore.
    }
    let _ = conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_boards_slug ON boards(slug) WHERE slug IS NOT NULL",
        [],
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connection::open_memory;

    #[test]
    fn init_creates_all_tables() {
        let conn = open_memory().expect("open");
        let mut tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .map(|r| r.unwrap())
            .filter(|n| !n.starts_with("sqlite_"))
            .collect();
        tables.sort();
        assert_eq!(
            tables,
            vec![
                "boards",
                "card_commits",
                "card_criteria",
                "card_files",
                "card_tags",
                "cards",
                "comments",
                "config",
                "executions",
            ]
        );
    }

    #[test]
    fn init_inserts_global_config() {
        let conn = open_memory().expect("open");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM config WHERE key='global'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn init_is_idempotent() {
        let conn = open_memory().expect("open");
        // Re-running init must not error.
        init(&conn).unwrap();
        init(&conn).unwrap();
    }

    #[test]
    fn migrations_no_op_on_fresh_schema() {
        let conn = open_memory().expect("open");
        // Re-applying migrations on a fresh schema must not change column count.
        let cols_before: i64 = conn
            .query_row("SELECT COUNT(*) FROM pragma_table_info('cards')", [], |r| r.get(0))
            .unwrap();
        apply_migrations(&conn);
        let cols_after: i64 = conn
            .query_row("SELECT COUNT(*) FROM pragma_table_info('cards')", [], |r| r.get(0))
            .unwrap();
        assert_eq!(cols_before, cols_after);
    }
}
```

- [ ] **Step 2: Run tests, expect green**

Run: `cd rust && cargo test -p glue-paste-dev-core db::schema`
Expected: 4 tests pass.

- [ ] **Step 3: Run connection tests too**

Run: `cd rust && cargo test -p glue-paste-dev-core db::connection`
Expected: 2 tests pass.

- [ ] **Step 4: Commit**

```bash
git add rust/crates/core/src/db/schema.rs
git commit -m "feat(rust-core): port schema and legacy migrations"
```

---

### Task 5: Types module + ts-rs scaffolding

**Files:**
- Modify: `rust/crates/core/src/types/mod.rs`
- Create: `rust/crates/core/src/types/board.rs`
- Create: `rust/crates/core/src/types/card.rs`
- Create: `rust/crates/core/src/types/comment.rs`
- Create: `rust/crates/core/src/types/execution.rs`
- Create: `rust/crates/core/src/types/criterion.rs`
- Create: `rust/crates/core/src/types/commit.rs`
- Create: `rust/crates/core/src/types/config.rs`

Each struct: `#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, ts_rs::TS)]` plus `#[ts(export, export_to = "../../../packages/dashboard/src/types/generated/")]` so `cargo test` writes a `.ts` file per type into the dashboard's generated dir.

Field names use `snake_case` matching the SQL column names (matches current Bun-side type shape — confirmed by reading `packages/dashboard/src/lib/api.ts`).

- [ ] **Step 1: Write `types/mod.rs`**

Replace `rust/crates/core/src/types/mod.rs` with:
```rust
pub mod board;
pub mod card;
pub mod comment;
pub mod execution;
pub mod criterion;
pub mod commit;
pub mod config;

pub use board::*;
pub use card::*;
pub use comment::*;
pub use execution::*;
pub use criterion::*;
pub use commit::*;
pub use config::*;
```

- [ ] **Step 2: Write `types/board.rs`**

```rust
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/dashboard/src/types/generated/")]
pub struct Board {
    pub id: String,
    pub name: String,
    pub description: String,
    pub directory: String,
    pub session_id: Option<String>,
    pub color: Option<String>,
    pub scratchpad: String,
    pub slug: Option<String>,
    pub github_url: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/dashboard/src/types/generated/")]
pub struct CreateBoard {
    pub name: String,
    pub description: String,
    pub directory: String,
    pub color: Option<String>,
    pub slug: Option<String>,
    pub github_url: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/dashboard/src/types/generated/")]
pub struct UpdateBoard {
    pub name: Option<String>,
    pub description: Option<String>,
    pub directory: Option<String>,
    pub color: Option<Option<String>>,
    pub scratchpad: Option<String>,
    pub slug: Option<Option<String>>,
    pub github_url: Option<Option<String>>,
}
```

- [ ] **Step 3: Write `types/card.rs`**

```rust
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[ts(export, export_to = "../../../packages/dashboard/src/types/generated/")]
#[serde(rename_all = "kebab-case")]
pub enum CardStatus {
    Todo,
    Queued,
    #[serde(rename = "in-progress")]
    InProgress,
    Done,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[ts(export, export_to = "../../../packages/dashboard/src/types/generated/")]
#[serde(rename_all = "lowercase")]
pub enum Assignee {
    Ai,
    Human,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/dashboard/src/types/generated/")]
pub struct Card {
    pub id: String,
    pub board_id: String,
    pub title: String,
    pub description: String,
    pub status: CardStatus,
    pub position: i64,
    pub blocking: i64,
    pub plan_thinking: Option<String>,
    pub execute_thinking: Option<String>,
    pub auto_commit: Option<i64>,
    pub auto_push: Option<i64>,
    pub assignee: Assignee,
    pub cli_provider: Option<String>,
    pub cli_custom_command: Option<String>,
    pub branch_mode: Option<String>,
    pub branch_name: Option<String>,
    pub plan_summary: Option<String>,
    pub completion_summary: Option<String>,
    pub blocker: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/dashboard/src/types/generated/")]
pub struct CardWithTags {
    #[serde(flatten)]
    pub card: Card,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/dashboard/src/types/generated/")]
pub struct CreateCard {
    pub title: String,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
    pub assignee: Option<Assignee>,
}

#[derive(Debug, Clone, Default, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/dashboard/src/types/generated/")]
pub struct UpdateCard {
    pub title: Option<String>,
    pub description: Option<String>,
    pub status: Option<CardStatus>,
    pub tags: Option<Vec<String>>,
    pub assignee: Option<Assignee>,
    pub plan_thinking: Option<Option<String>>,
    pub execute_thinking: Option<Option<String>>,
    pub auto_commit: Option<Option<i64>>,
    pub auto_push: Option<Option<i64>>,
    pub cli_provider: Option<Option<String>>,
    pub cli_custom_command: Option<Option<String>>,
    pub branch_mode: Option<Option<String>>,
    pub branch_name: Option<Option<String>>,
    pub blocker: Option<Option<String>>,
}
```

- [ ] **Step 4: Write `types/comment.rs`, `types/execution.rs`, `types/criterion.rs`, `types/commit.rs`, `types/config.rs`**

Write `rust/crates/core/src/types/comment.rs`:
```rust
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[ts(export, export_to = "../../../packages/dashboard/src/types/generated/")]
#[serde(rename_all = "lowercase")]
pub enum CommentAuthor {
    User,
    System,
    Ai,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/dashboard/src/types/generated/")]
pub struct Comment {
    pub id: String,
    pub card_id: String,
    pub author: CommentAuthor,
    pub content: String,
    pub execution_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/dashboard/src/types/generated/")]
pub struct CreateComment {
    pub author: CommentAuthor,
    pub content: String,
    pub execution_id: Option<String>,
}
```

Write `rust/crates/core/src/types/execution.rs`:
```rust
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[ts(export, export_to = "../../../packages/dashboard/src/types/generated/")]
#[serde(rename_all = "lowercase")]
pub enum ExecutionPhase {
    Plan,
    Execute,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[ts(export, export_to = "../../../packages/dashboard/src/types/generated/")]
#[serde(rename_all = "lowercase")]
pub enum ExecutionStatus {
    Running,
    Success,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/dashboard/src/types/generated/")]
pub struct Execution {
    pub id: String,
    pub card_id: String,
    pub session_id: Option<String>,
    pub phase: ExecutionPhase,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub status: ExecutionStatus,
    pub output: String,
    pub cost_usd: f64,
    pub exit_code: Option<i64>,
    pub retry_count: i64,
    pub pid: Option<i64>,
    pub files_changed: Option<String>,
}
```

Write `rust/crates/core/src/types/criterion.rs`:
```rust
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[ts(export, export_to = "../../../packages/dashboard/src/types/generated/")]
#[serde(rename_all = "lowercase")]
pub enum CriterionStatus {
    Pending,
    Pass,
    Fail,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[ts(export, export_to = "../../../packages/dashboard/src/types/generated/")]
#[serde(rename_all = "lowercase")]
pub enum CriterionSource {
    Ai,
    User,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/dashboard/src/types/generated/")]
pub struct Criterion {
    pub id: String,
    pub card_id: String,
    pub text: String,
    pub status: CriterionStatus,
    pub source: CriterionSource,
    pub evidence: Option<String>,
    pub execution_id: Option<String>,
    pub position: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/dashboard/src/types/generated/")]
pub struct CreateCriterion {
    pub text: String,
    pub source: CriterionSource,
}

#[derive(Debug, Clone, Default, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/dashboard/src/types/generated/")]
pub struct UpdateCriterion {
    pub text: Option<String>,
    pub status: Option<CriterionStatus>,
    pub evidence: Option<Option<String>>,
}
```

Write `rust/crates/core/src/types/commit.rs`:
```rust
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/dashboard/src/types/generated/")]
pub struct CardCommit {
    pub id: String,
    pub card_id: String,
    pub execution_id: Option<String>,
    pub sha: String,
    pub message: String,
    pub author_name: String,
    pub author_email: String,
    pub files_changed: Option<String>,
    pub created_at: String,
}
```

Write `rust/crates/core/src/types/config.rs`:
```rust
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/dashboard/src/types/generated/")]
pub struct Config {
    pub key: String,
    pub cli_provider: Option<String>,
    pub cli_custom_command: Option<String>,
    pub model: Option<String>,
    pub max_budget_usd: Option<f64>,
    pub plan_mode: Option<i64>,
    pub thinking_level: Option<String>,
    pub custom_tags: Option<String>,
    pub custom_instructions: Option<String>,
    pub plan_thinking: Option<String>,
    pub execute_thinking: Option<String>,
    pub auto_commit: Option<i64>,
    pub plan_model: Option<String>,
    pub execute_model: Option<String>,
    pub auto_push: Option<i64>,
    pub branch_mode: Option<String>,
    pub branch_name: Option<String>,
    pub max_concurrent_cards: Option<i64>,
}
```

- [ ] **Step 5: Verify builds**

Run: `cd rust && cargo build -p glue-paste-dev-core`
Expected: clean build (possibly warnings on unused imports — ignore).

- [ ] **Step 6: Generate TypeScript types**

Run: `cd rust && cargo test -p glue-paste-dev-core --features=""`

`ts-rs` exports happen during `cargo test` (`#[ts(export)]` runs in a test). After running, verify files exist:

Run: `ls packages/dashboard/src/types/generated/`
Expected: `Board.ts`, `Card.ts`, `Comment.ts`, `Execution.ts`, etc.

Open one (`Board.ts`) and confirm shape:
```typescript
export type Board = {
  id: string;
  name: string;
  description: string;
  directory: string;
  session_id: string | null;
  color: string | null;
  scratchpad: string;
  slug: string | null;
  github_url: string | null;
  created_at: string;
  updated_at: string;
};
```

- [ ] **Step 7: Verify dashboard compiles against generated types**

Modify `packages/dashboard/src/lib/api.ts:1` — replace existing `Board` import path with the generated one (temporary verification only — revert after):
```typescript
import type { Board } from "../types/generated/Board";
```

Run: `cd packages/dashboard && bunx tsc -b`
Expected: compiles cleanly.

REVERT the test change (`git checkout packages/dashboard/src/lib/api.ts`) before committing. The full dashboard switch happens in Phase 4.

- [ ] **Step 8: Commit**

```bash
git add rust/crates/core/src/types packages/dashboard/src/types/generated
git commit -m "feat(rust-core): port types with ts-rs generation"
```

---

### Task 6: Boards CRUD

**Files:**
- Create: `rust/crates/core/src/db/boards.rs`
- Modify: `rust/crates/core/src/db/mod.rs`

Mirrors `packages/core/src/db/boards.ts`. Functions: `list`, `get`, `create`, `update`, `delete`.

- [ ] **Step 1: Add `pub mod boards;` to `db/mod.rs`**

Modify `rust/crates/core/src/db/mod.rs`:
```rust
pub mod connection;
pub mod schema;
pub mod boards;
```

- [ ] **Step 2: Write failing tests**

Write `rust/crates/core/src/db/boards.rs`:
```rust
use rusqlite::{params, Connection, OptionalExtension};

use crate::types::{Board, CreateBoard, UpdateBoard};
use crate::Result;

pub fn list(conn: &Connection) -> Result<Vec<Board>> {
    let mut stmt = conn.prepare("SELECT * FROM boards ORDER BY updated_at DESC")?;
    let rows = stmt
        .query_map([], row_to_board)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<Board>> {
    let board = conn
        .query_row("SELECT * FROM boards WHERE id = ?", [id], row_to_board)
        .optional()?;
    Ok(board)
}

pub fn create(conn: &Connection, input: &CreateBoard) -> Result<Board> {
    let session_id = uuid::Uuid::new_v4().to_string();
    let board = conn.query_row(
        "INSERT INTO boards (name, description, directory, session_id, color, slug, github_url)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING *",
        params![
            input.name,
            input.description,
            input.directory,
            session_id,
            input.color,
            input.slug,
            input.github_url
        ],
        row_to_board,
    )?;
    Ok(board)
}

pub fn update(conn: &Connection, id: &str, input: &UpdateBoard) -> Result<Option<Board>> {
    let Some(current) = get(conn, id)? else {
        return Ok(None);
    };
    let name = input.name.clone().unwrap_or(current.name);
    let description = input.description.clone().unwrap_or(current.description);
    let directory = input.directory.clone().unwrap_or(current.directory);
    let color = match &input.color {
        Some(v) => v.clone(),
        None => current.color,
    };
    let scratchpad = input.scratchpad.clone().unwrap_or(current.scratchpad);
    let slug = match &input.slug {
        Some(v) => v.clone(),
        None => current.slug,
    };
    let github_url = match &input.github_url {
        Some(v) => v.clone(),
        None => current.github_url,
    };

    let board = conn.query_row(
        "UPDATE boards
            SET name = ?, description = ?, directory = ?, color = ?, scratchpad = ?, slug = ?, github_url = ?, updated_at = datetime('now')
            WHERE id = ?
            RETURNING *",
        params![name, description, directory, color, scratchpad, slug, github_url, id],
        row_to_board,
    )?;
    Ok(Some(board))
}

pub fn delete(conn: &Connection, id: &str) -> Result<bool> {
    let changes = conn.execute("DELETE FROM boards WHERE id = ?", [id])?;
    Ok(changes > 0)
}

fn row_to_board(row: &rusqlite::Row<'_>) -> rusqlite::Result<Board> {
    Ok(Board {
        id: row.get("id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        directory: row.get("directory")?,
        session_id: row.get("session_id")?,
        color: row.get("color")?,
        scratchpad: row.get("scratchpad")?,
        slug: row.get("slug")?,
        github_url: row.get("github_url")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connection::open_memory;
    use crate::types::CreateBoard;

    fn sample() -> CreateBoard {
        CreateBoard {
            name: "Alpha".into(),
            description: "desc".into(),
            directory: "/tmp/alpha".into(),
            color: Some("#ff0000".into()),
            slug: Some("alpha".into()),
            github_url: None,
        }
    }

    #[test]
    fn create_then_get() {
        let conn = open_memory().unwrap();
        let created = create(&conn, &sample()).unwrap();
        assert_eq!(created.name, "Alpha");
        let fetched = get(&conn, &created.id).unwrap().unwrap();
        assert_eq!(fetched.id, created.id);
    }

    #[test]
    fn list_orders_by_updated_at_desc() {
        let conn = open_memory().unwrap();
        let a = create(&conn, &sample()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1100));
        let mut second = sample();
        second.name = "Beta".into();
        let b = create(&conn, &second).unwrap();
        let list = list(&conn).unwrap();
        assert_eq!(list[0].id, b.id);
        assert_eq!(list[1].id, a.id);
    }

    #[test]
    fn update_changes_fields() {
        let conn = open_memory().unwrap();
        let created = create(&conn, &sample()).unwrap();
        let mut patch = UpdateBoard::default();
        patch.name = Some("Renamed".into());
        let updated = update(&conn, &created.id, &patch).unwrap().unwrap();
        assert_eq!(updated.name, "Renamed");
        assert_eq!(updated.description, "desc");
    }

    #[test]
    fn delete_returns_true_then_false() {
        let conn = open_memory().unwrap();
        let created = create(&conn, &sample()).unwrap();
        assert!(delete(&conn, &created.id).unwrap());
        assert!(!delete(&conn, &created.id).unwrap());
    }
}
```

- [ ] **Step 3: Run tests**

Run: `cd rust && cargo test -p glue-paste-dev-core db::boards`
Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add rust/crates/core/src/db/boards.rs rust/crates/core/src/db/mod.rs
git commit -m "feat(rust-core): port boards CRUD"
```

---

### Task 7: Cards CRUD (+ tags + position management)

**Files:**
- Create: `rust/crates/core/src/db/cards.rs`
- Modify: `rust/crates/core/src/db/mod.rs`

Mirrors `packages/core/src/db/cards.ts`. Read that file BEFORE writing code — Bun version has many helpers: `listForBoard`, `getCardWithTags`, `create`, `update`, `moveCard`, `countActiveCards`, `setStatus`. Reproduce all of them. Use the same SQL patterns. Tag handling: cards have a parallel `card_tags` table; CRUD merges them on read.

**Step 1: Read the Bun implementation**

Run: open `packages/core/src/db/cards.ts` and review every exported function. Note Bun version exports a namespace `cardsDb` with these functions: `listForBoard`, `getWithTags`, `create`, `update`, `move`, `setStatus`, `countActiveCards`, `delete`, `setPlanSummary`, `setCompletionSummary`, `setBlocker`, `clearBlocker`.

- [ ] **Step 2: Add `pub mod cards;` to `db/mod.rs`**

```rust
pub mod cards;
```

- [ ] **Step 3: Implement `cards.rs` with full CRUD + tags + helpers**

Write `rust/crates/core/src/db/cards.rs`. Structure:

```rust
use rusqlite::{params, Connection, OptionalExtension};

use crate::types::{Card, CardStatus, CardWithTags, CreateCard, UpdateCard};
use crate::Result;

pub fn list_for_board(conn: &Connection, board_id: &str, done_limit: i64) -> Result<(Vec<CardWithTags>, bool)> {
    // Fetch all non-done cards + last N done cards
    let mut stmt = conn.prepare(
        "SELECT * FROM cards
         WHERE board_id = ? AND status != 'done'
         ORDER BY position ASC, created_at ASC",
    )?;
    let mut cards: Vec<Card> = stmt
        .query_map([board_id], row_to_card)?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut done_stmt = conn.prepare(
        "SELECT * FROM cards
         WHERE board_id = ? AND status = 'done'
         ORDER BY updated_at DESC
         LIMIT ?",
    )?;
    let done: Vec<Card> = done_stmt
        .query_map(params![board_id, done_limit], row_to_card)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    cards.extend(done);

    // Count remaining done cards beyond the limit
    let total_done: i64 = conn.query_row(
        "SELECT COUNT(*) FROM cards WHERE board_id = ? AND status = 'done'",
        [board_id],
        |r| r.get(0),
    )?;
    let done_has_more = total_done > done_limit;

    // Attach tags to each card
    let with_tags = cards
        .into_iter()
        .map(|c| {
            let tags = tags_for_card(conn, &c.id).unwrap_or_default();
            CardWithTags { card: c, tags }
        })
        .collect();

    Ok((with_tags, done_has_more))
}

pub fn get_with_tags(conn: &Connection, id: &str) -> Result<Option<CardWithTags>> {
    let card = conn
        .query_row("SELECT * FROM cards WHERE id = ?", [id], row_to_card)
        .optional()?;
    match card {
        Some(c) => {
            let tags = tags_for_card(conn, &c.id)?;
            Ok(Some(CardWithTags { card: c, tags }))
        }
        None => Ok(None),
    }
}

pub fn create(conn: &Connection, board_id: &str, input: &CreateCard) -> Result<CardWithTags> {
    let next_position: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM cards WHERE board_id = ? AND status = 'todo'",
        [board_id],
        |r| r.get(0),
    )?;

    let assignee = input.assignee.clone().unwrap_or(crate::types::Assignee::Ai);
    let assignee_str = match assignee {
        crate::types::Assignee::Ai => "ai",
        crate::types::Assignee::Human => "human",
    };

    let card = conn.query_row(
        "INSERT INTO cards (board_id, title, description, position, assignee)
         VALUES (?, ?, ?, ?, ?)
         RETURNING *",
        params![
            board_id,
            input.title,
            input.description.clone().unwrap_or_default(),
            next_position,
            assignee_str
        ],
        row_to_card,
    )?;

    if let Some(tags) = &input.tags {
        for tag in tags {
            conn.execute(
                "INSERT OR IGNORE INTO card_tags (card_id, tag) VALUES (?, ?)",
                params![card.id, tag],
            )?;
        }
    }

    let tags = tags_for_card(conn, &card.id)?;
    Ok(CardWithTags { card, tags })
}

pub fn update(conn: &Connection, id: &str, input: &UpdateCard) -> Result<Option<CardWithTags>> {
    let Some(current) = get_with_tags(conn, id)? else {
        return Ok(None);
    };
    let c = &current.card;

    let title = input.title.clone().unwrap_or_else(|| c.title.clone());
    let description = input.description.clone().unwrap_or_else(|| c.description.clone());
    let status = input.status.clone().unwrap_or_else(|| c.status.clone());
    let assignee = input.assignee.clone().unwrap_or_else(|| c.assignee.clone());

    let status_str = status_to_str(&status);
    let assignee_str = match assignee {
        crate::types::Assignee::Ai => "ai",
        crate::types::Assignee::Human => "human",
    };

    conn.execute(
        "UPDATE cards SET title = ?, description = ?, status = ?, assignee = ?, updated_at = datetime('now') WHERE id = ?",
        params![title, description, status_str, assignee_str, id],
    )?;

    if let Some(new_tags) = &input.tags {
        conn.execute("DELETE FROM card_tags WHERE card_id = ?", [id])?;
        for tag in new_tags {
            conn.execute(
                "INSERT OR IGNORE INTO card_tags (card_id, tag) VALUES (?, ?)",
                params![id, tag],
            )?;
        }
    }

    get_with_tags(conn, id)
}

pub fn move_card(conn: &Connection, id: &str, status: CardStatus, position: i64) -> Result<Option<CardWithTags>> {
    let status_str = status_to_str(&status);
    conn.execute(
        "UPDATE cards SET status = ?, position = ?, updated_at = datetime('now') WHERE id = ?",
        params![status_str, position, id],
    )?;
    get_with_tags(conn, id)
}

pub fn set_status(conn: &Connection, id: &str, status: CardStatus) -> Result<()> {
    let status_str = status_to_str(&status);
    conn.execute(
        "UPDATE cards SET status = ?, updated_at = datetime('now') WHERE id = ?",
        params![status_str, id],
    )?;
    Ok(())
}

pub fn count_active(conn: &Connection) -> Result<i64> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM cards WHERE status IN ('queued', 'in-progress')",
        [],
        |r| r.get(0),
    )?;
    Ok(n)
}

pub fn delete(conn: &Connection, id: &str) -> Result<bool> {
    let n = conn.execute("DELETE FROM cards WHERE id = ?", [id])?;
    Ok(n > 0)
}

pub fn set_plan_summary(conn: &Connection, id: &str, summary: Option<&str>) -> Result<()> {
    conn.execute(
        "UPDATE cards SET plan_summary = ?, updated_at = datetime('now') WHERE id = ?",
        params![summary, id],
    )?;
    Ok(())
}

pub fn set_completion_summary(conn: &Connection, id: &str, summary: Option<&str>) -> Result<()> {
    conn.execute(
        "UPDATE cards SET completion_summary = ?, updated_at = datetime('now') WHERE id = ?",
        params![summary, id],
    )?;
    Ok(())
}

pub fn set_blocker(conn: &Connection, id: &str, blocker: Option<&str>) -> Result<()> {
    conn.execute(
        "UPDATE cards SET blocker = ?, updated_at = datetime('now') WHERE id = ?",
        params![blocker, id],
    )?;
    Ok(())
}

pub fn clear_blocker(conn: &Connection, id: &str) -> Result<()> {
    set_blocker(conn, id, None)
}

fn tags_for_card(conn: &Connection, card_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT tag FROM card_tags WHERE card_id = ? ORDER BY tag")?;
    let tags: Vec<String> = stmt
        .query_map([card_id], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(tags)
}

fn status_to_str(s: &CardStatus) -> &'static str {
    match s {
        CardStatus::Todo => "todo",
        CardStatus::Queued => "queued",
        CardStatus::InProgress => "in-progress",
        CardStatus::Done => "done",
        CardStatus::Failed => "failed",
    }
}

fn row_to_card(row: &rusqlite::Row<'_>) -> rusqlite::Result<Card> {
    let status_str: String = row.get("status")?;
    let status = match status_str.as_str() {
        "todo" => CardStatus::Todo,
        "queued" => CardStatus::Queued,
        "in-progress" => CardStatus::InProgress,
        "done" => CardStatus::Done,
        "failed" => CardStatus::Failed,
        other => return Err(rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            format!("unknown status: {other}").into(),
        )),
    };
    let assignee_str: String = row.get("assignee")?;
    let assignee = match assignee_str.as_str() {
        "ai" => crate::types::Assignee::Ai,
        "human" => crate::types::Assignee::Human,
        other => return Err(rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            format!("unknown assignee: {other}").into(),
        )),
    };
    Ok(Card {
        id: row.get("id")?,
        board_id: row.get("board_id")?,
        title: row.get("title")?,
        description: row.get("description")?,
        status,
        position: row.get("position")?,
        blocking: row.get("blocking")?,
        plan_thinking: row.get("plan_thinking")?,
        execute_thinking: row.get("execute_thinking")?,
        auto_commit: row.get("auto_commit")?,
        auto_push: row.get("auto_push")?,
        assignee,
        cli_provider: row.get("cli_provider")?,
        cli_custom_command: row.get("cli_custom_command")?,
        branch_mode: row.get("branch_mode")?,
        branch_name: row.get("branch_name")?,
        plan_summary: row.get("plan_summary")?,
        completion_summary: row.get("completion_summary")?,
        blocker: row.get("blocker")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{boards, connection::open_memory};
    use crate::types::{CreateBoard, CreateCard};

    fn setup() -> (rusqlite::Connection, String) {
        let conn = open_memory().unwrap();
        let board = boards::create(
            &conn,
            &CreateBoard {
                name: "B".into(),
                description: String::new(),
                directory: "/tmp".into(),
                color: None,
                slug: None,
                github_url: None,
            },
        )
        .unwrap();
        (conn, board.id)
    }

    #[test]
    fn create_assigns_next_position() {
        let (conn, board_id) = setup();
        let a = create(&conn, &board_id, &CreateCard { title: "a".into(), description: None, tags: None, assignee: None }).unwrap();
        let b = create(&conn, &board_id, &CreateCard { title: "b".into(), description: None, tags: None, assignee: None }).unwrap();
        assert_eq!(a.card.position, 0);
        assert_eq!(b.card.position, 1);
    }

    #[test]
    fn tags_round_trip() {
        let (conn, board_id) = setup();
        let card = create(
            &conn,
            &board_id,
            &CreateCard {
                title: "t".into(),
                description: None,
                tags: Some(vec!["x".into(), "y".into()]),
                assignee: None,
            },
        )
        .unwrap();
        assert_eq!(card.tags, vec!["x".to_string(), "y".to_string()]);
    }

    #[test]
    fn update_replaces_tags() {
        let (conn, board_id) = setup();
        let card = create(&conn, &board_id, &CreateCard { title: "t".into(), description: None, tags: Some(vec!["a".into()]), assignee: None }).unwrap();
        let mut patch = UpdateCard::default();
        patch.tags = Some(vec!["b".into(), "c".into()]);
        let updated = update(&conn, &card.card.id, &patch).unwrap().unwrap();
        assert_eq!(updated.tags, vec!["b".to_string(), "c".to_string()]);
    }

    #[test]
    fn move_card_changes_status_and_position() {
        let (conn, board_id) = setup();
        let card = create(&conn, &board_id, &CreateCard { title: "t".into(), description: None, tags: None, assignee: None }).unwrap();
        let moved = move_card(&conn, &card.card.id, CardStatus::Queued, 5).unwrap().unwrap();
        assert_eq!(moved.card.status, CardStatus::Queued);
        assert_eq!(moved.card.position, 5);
    }

    #[test]
    fn count_active_counts_queued_and_in_progress() {
        let (conn, board_id) = setup();
        let a = create(&conn, &board_id, &CreateCard { title: "a".into(), description: None, tags: None, assignee: None }).unwrap();
        let b = create(&conn, &board_id, &CreateCard { title: "b".into(), description: None, tags: None, assignee: None }).unwrap();
        let c = create(&conn, &board_id, &CreateCard { title: "c".into(), description: None, tags: None, assignee: None }).unwrap();
        move_card(&conn, &a.card.id, CardStatus::Queued, 0).unwrap();
        move_card(&conn, &b.card.id, CardStatus::InProgress, 0).unwrap();
        move_card(&conn, &c.card.id, CardStatus::Done, 0).unwrap();
        assert_eq!(count_active(&conn).unwrap(), 2);
    }
}
```

- [ ] **Step 4: Run tests**

Run: `cd rust && cargo test -p glue-paste-dev-core db::cards`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add rust/crates/core/src/db/cards.rs rust/crates/core/src/db/mod.rs
git commit -m "feat(rust-core): port cards CRUD with tags"
```

---

### Task 8: Comments CRUD

**Files:**
- Create: `rust/crates/core/src/db/comments.rs`
- Modify: `rust/crates/core/src/db/mod.rs`

Mirrors `packages/core/src/db/comments.ts`. Functions: `list_for_card`, `create`, `clear_for_card`.

- [ ] **Step 1: Add module**

Append to `rust/crates/core/src/db/mod.rs`:
```rust
pub mod comments;
```

- [ ] **Step 2: Implement with tests**

Write `rust/crates/core/src/db/comments.rs`:
```rust
use rusqlite::{params, Connection};

use crate::types::{Comment, CommentAuthor, CreateComment};
use crate::Result;

pub fn list_for_card(conn: &Connection, card_id: &str) -> Result<Vec<Comment>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM comments WHERE card_id = ? ORDER BY created_at ASC",
    )?;
    let rows = stmt
        .query_map([card_id], row_to_comment)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn create(conn: &Connection, card_id: &str, input: &CreateComment) -> Result<Comment> {
    let author = author_to_str(&input.author);
    let comment = conn.query_row(
        "INSERT INTO comments (card_id, author, content, execution_id)
         VALUES (?, ?, ?, ?)
         RETURNING *",
        params![card_id, author, input.content, input.execution_id],
        row_to_comment,
    )?;
    Ok(comment)
}

pub fn clear_for_card(conn: &Connection, card_id: &str) -> Result<usize> {
    let n = conn.execute("DELETE FROM comments WHERE card_id = ?", [card_id])?;
    Ok(n)
}

fn author_to_str(a: &CommentAuthor) -> &'static str {
    match a {
        CommentAuthor::User => "user",
        CommentAuthor::System => "system",
        CommentAuthor::Ai => "ai",
    }
}

fn row_to_comment(row: &rusqlite::Row<'_>) -> rusqlite::Result<Comment> {
    let author_str: String = row.get("author")?;
    let author = match author_str.as_str() {
        "user" => CommentAuthor::User,
        "system" => CommentAuthor::System,
        "ai" => CommentAuthor::Ai,
        other => return Err(rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            format!("unknown author: {other}").into(),
        )),
    };
    Ok(Comment {
        id: row.get("id")?,
        card_id: row.get("card_id")?,
        author,
        content: row.get("content")?,
        execution_id: row.get("execution_id")?,
        created_at: row.get("created_at")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{boards, cards, connection::open_memory};
    use crate::types::{CreateBoard, CreateCard};

    fn setup() -> (rusqlite::Connection, String) {
        let conn = open_memory().unwrap();
        let board = boards::create(&conn, &CreateBoard {
            name: "b".into(), description: "".into(), directory: "/tmp".into(),
            color: None, slug: None, github_url: None,
        }).unwrap();
        let card = cards::create(&conn, &board.id, &CreateCard { title: "c".into(), description: None, tags: None, assignee: None }).unwrap();
        (conn, card.card.id)
    }

    #[test]
    fn create_then_list() {
        let (conn, card_id) = setup();
        create(&conn, &card_id, &CreateComment {
            author: CommentAuthor::User,
            content: "hi".into(),
            execution_id: None,
        }).unwrap();
        let list = list_for_card(&conn, &card_id).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].content, "hi");
    }

    #[test]
    fn clear_removes_all() {
        let (conn, card_id) = setup();
        for i in 0..3 {
            create(&conn, &card_id, &CreateComment {
                author: CommentAuthor::User,
                content: format!("c{i}"),
                execution_id: None,
            }).unwrap();
        }
        let removed = clear_for_card(&conn, &card_id).unwrap();
        assert_eq!(removed, 3);
        assert_eq!(list_for_card(&conn, &card_id).unwrap().len(), 0);
    }
}
```

- [ ] **Step 3: Run + commit**

Run: `cd rust && cargo test -p glue-paste-dev-core db::comments`
Expected: 2 tests pass.

```bash
git add rust/crates/core/src/db/comments.rs rust/crates/core/src/db/mod.rs
git commit -m "feat(rust-core): port comments CRUD"
```

---

### Task 9: Executions CRUD

**Files:**
- Create: `rust/crates/core/src/db/executions.rs`
- Modify: `rust/crates/core/src/db/mod.rs`

Mirrors `packages/core/src/db/executions.ts`. Functions: `create_execution`, `append_output`, `complete`, `cancel_running`, `list_for_card`, `get`.

- [ ] **Step 1: Add module and implement**

Append to `rust/crates/core/src/db/mod.rs`:
```rust
pub mod executions;
```

Write `rust/crates/core/src/db/executions.rs`:
```rust
use rusqlite::{params, Connection, OptionalExtension};

use crate::types::{Execution, ExecutionPhase, ExecutionStatus};
use crate::Result;

pub fn create_execution(
    conn: &Connection,
    card_id: &str,
    session_id: &str,
    phase: ExecutionPhase,
) -> Result<Execution> {
    let phase_str = phase_to_str(&phase);
    let execution = conn.query_row(
        "INSERT INTO executions (card_id, session_id, phase)
         VALUES (?, ?, ?)
         RETURNING *",
        params![card_id, session_id, phase_str],
        row_to_execution,
    )?;
    Ok(execution)
}

pub fn append_output(conn: &Connection, id: &str, chunk: &str) -> Result<()> {
    conn.execute(
        "UPDATE executions SET output = output || ? WHERE id = ?",
        params![chunk, id],
    )?;
    Ok(())
}

pub fn complete(
    conn: &Connection,
    id: &str,
    status: ExecutionStatus,
    exit_code: Option<i64>,
    cost_usd: f64,
    files_changed: Option<&str>,
) -> Result<()> {
    let status_str = status_to_str(&status);
    conn.execute(
        "UPDATE executions
            SET status = ?, exit_code = ?, cost_usd = ?, files_changed = ?,
                finished_at = datetime('now')
            WHERE id = ?",
        params![status_str, exit_code, cost_usd, files_changed, id],
    )?;
    Ok(())
}

pub fn cancel_running(conn: &Connection) -> Result<usize> {
    let n = conn.execute(
        "UPDATE executions SET status = 'cancelled', finished_at = datetime('now') WHERE status = 'running'",
        [],
    )?;
    Ok(n)
}

pub fn list_for_card(conn: &Connection, card_id: &str) -> Result<Vec<Execution>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM executions WHERE card_id = ? ORDER BY started_at ASC",
    )?;
    let rows = stmt
        .query_map([card_id], row_to_execution)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<Execution>> {
    let ex = conn
        .query_row("SELECT * FROM executions WHERE id = ?", [id], row_to_execution)
        .optional()?;
    Ok(ex)
}

fn phase_to_str(p: &ExecutionPhase) -> &'static str {
    match p {
        ExecutionPhase::Plan => "plan",
        ExecutionPhase::Execute => "execute",
    }
}

fn status_to_str(s: &ExecutionStatus) -> &'static str {
    match s {
        ExecutionStatus::Running => "running",
        ExecutionStatus::Success => "success",
        ExecutionStatus::Failed => "failed",
        ExecutionStatus::Cancelled => "cancelled",
    }
}

fn row_to_execution(row: &rusqlite::Row<'_>) -> rusqlite::Result<Execution> {
    let phase_str: String = row.get("phase")?;
    let phase = match phase_str.as_str() {
        "plan" => ExecutionPhase::Plan,
        "execute" => ExecutionPhase::Execute,
        other => return Err(rusqlite::Error::FromSqlConversionFailure(
            0, rusqlite::types::Type::Text, format!("unknown phase: {other}").into(),
        )),
    };
    let status_str: String = row.get("status")?;
    let status = match status_str.as_str() {
        "running" => ExecutionStatus::Running,
        "success" => ExecutionStatus::Success,
        "failed" => ExecutionStatus::Failed,
        "cancelled" => ExecutionStatus::Cancelled,
        other => return Err(rusqlite::Error::FromSqlConversionFailure(
            0, rusqlite::types::Type::Text, format!("unknown status: {other}").into(),
        )),
    };
    Ok(Execution {
        id: row.get("id")?,
        card_id: row.get("card_id")?,
        session_id: row.get("session_id")?,
        phase,
        started_at: row.get("started_at")?,
        finished_at: row.get("finished_at")?,
        status,
        output: row.get("output")?,
        cost_usd: row.get("cost_usd")?,
        exit_code: row.get("exit_code")?,
        retry_count: row.get("retry_count")?,
        pid: row.get("pid")?,
        files_changed: row.get("files_changed")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{boards, cards, connection::open_memory};
    use crate::types::{CreateBoard, CreateCard};

    fn setup() -> (rusqlite::Connection, String) {
        let conn = open_memory().unwrap();
        let b = boards::create(&conn, &CreateBoard {
            name: "b".into(), description: "".into(), directory: "/tmp".into(),
            color: None, slug: None, github_url: None,
        }).unwrap();
        let c = cards::create(&conn, &b.id, &CreateCard { title: "c".into(), description: None, tags: None, assignee: None }).unwrap();
        (conn, c.card.id)
    }

    #[test]
    fn create_then_append_then_complete() {
        let (conn, card_id) = setup();
        let ex = create_execution(&conn, &card_id, "sess-1", ExecutionPhase::Plan).unwrap();
        append_output(&conn, &ex.id, "hello ").unwrap();
        append_output(&conn, &ex.id, "world").unwrap();
        complete(&conn, &ex.id, ExecutionStatus::Success, Some(0), 0.25, Some("a.txt\nb.txt")).unwrap();
        let fetched = get(&conn, &ex.id).unwrap().unwrap();
        assert_eq!(fetched.output, "hello world");
        assert_eq!(fetched.status, ExecutionStatus::Success);
        assert_eq!(fetched.exit_code, Some(0));
        assert!((fetched.cost_usd - 0.25).abs() < 1e-9);
    }

    #[test]
    fn cancel_running_only_affects_running() {
        let (conn, card_id) = setup();
        let a = create_execution(&conn, &card_id, "s", ExecutionPhase::Plan).unwrap();
        let b = create_execution(&conn, &card_id, "s", ExecutionPhase::Execute).unwrap();
        complete(&conn, &b.id, ExecutionStatus::Success, Some(0), 0.0, None).unwrap();
        let n = cancel_running(&conn).unwrap();
        assert_eq!(n, 1);
        let a2 = get(&conn, &a.id).unwrap().unwrap();
        assert_eq!(a2.status, ExecutionStatus::Cancelled);
        let b2 = get(&conn, &b.id).unwrap().unwrap();
        assert_eq!(b2.status, ExecutionStatus::Success);
    }
}
```

- [ ] **Step 2: Run + commit**

Run: `cd rust && cargo test -p glue-paste-dev-core db::executions`
Expected: 2 tests pass.

```bash
git add rust/crates/core/src/db/executions.rs rust/crates/core/src/db/mod.rs
git commit -m "feat(rust-core): port executions CRUD"
```

---

### Task 10: Criteria CRUD

**Files:**
- Create: `rust/crates/core/src/db/criteria.rs`
- Modify: `rust/crates/core/src/db/mod.rs`

Mirrors `packages/core/src/db/criteria.ts`. Functions: `list_for_card`, `add`, `update`, `remove`, `reorder`, `clear_for_card`.

- [ ] **Step 1: Add module + implement**

Append to `db/mod.rs`:
```rust
pub mod criteria;
```

Write `rust/crates/core/src/db/criteria.rs`:
```rust
use rusqlite::{params, Connection, OptionalExtension};

use crate::types::{CreateCriterion, Criterion, CriterionSource, CriterionStatus, UpdateCriterion};
use crate::Result;

pub fn list_for_card(conn: &Connection, card_id: &str) -> Result<Vec<Criterion>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM card_criteria WHERE card_id = ? ORDER BY position ASC, created_at ASC",
    )?;
    let rows = stmt
        .query_map([card_id], row_to_criterion)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn add(conn: &Connection, card_id: &str, input: &CreateCriterion) -> Result<Criterion> {
    let next_pos: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM card_criteria WHERE card_id = ?",
        [card_id],
        |r| r.get(0),
    )?;
    let source = source_to_str(&input.source);
    let c = conn.query_row(
        "INSERT INTO card_criteria (card_id, text, source, position)
         VALUES (?, ?, ?, ?)
         RETURNING *",
        params![card_id, input.text, source, next_pos],
        row_to_criterion,
    )?;
    Ok(c)
}

pub fn update(conn: &Connection, id: &str, input: &UpdateCriterion) -> Result<Option<Criterion>> {
    let Some(current) = get(conn, id)? else { return Ok(None); };
    let text = input.text.clone().unwrap_or(current.text);
    let status = input.status.clone().unwrap_or(current.status);
    let evidence = match &input.evidence {
        Some(v) => v.clone(),
        None => current.evidence,
    };
    let status_str = status_to_str(&status);
    let row = conn.query_row(
        "UPDATE card_criteria
            SET text = ?, status = ?, evidence = ?, updated_at = datetime('now')
            WHERE id = ?
            RETURNING *",
        params![text, status_str, evidence, id],
        row_to_criterion,
    )?;
    Ok(Some(row))
}

pub fn remove(conn: &Connection, id: &str) -> Result<bool> {
    let n = conn.execute("DELETE FROM card_criteria WHERE id = ?", [id])?;
    Ok(n > 0)
}

pub fn reorder(conn: &Connection, card_id: &str, ordered_ids: &[String]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    for (i, id) in ordered_ids.iter().enumerate() {
        tx.execute(
            "UPDATE card_criteria SET position = ?, updated_at = datetime('now')
             WHERE id = ? AND card_id = ?",
            params![i as i64, id, card_id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn clear_for_card(conn: &Connection, card_id: &str) -> Result<usize> {
    let n = conn.execute("DELETE FROM card_criteria WHERE card_id = ?", [card_id])?;
    Ok(n)
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<Criterion>> {
    let c = conn
        .query_row("SELECT * FROM card_criteria WHERE id = ?", [id], row_to_criterion)
        .optional()?;
    Ok(c)
}

fn status_to_str(s: &CriterionStatus) -> &'static str {
    match s {
        CriterionStatus::Pending => "pending",
        CriterionStatus::Pass => "pass",
        CriterionStatus::Fail => "fail",
    }
}

fn source_to_str(s: &CriterionSource) -> &'static str {
    match s {
        CriterionSource::Ai => "ai",
        CriterionSource::User => "user",
    }
}

fn row_to_criterion(row: &rusqlite::Row<'_>) -> rusqlite::Result<Criterion> {
    let status_str: String = row.get("status")?;
    let status = match status_str.as_str() {
        "pending" => CriterionStatus::Pending,
        "pass" => CriterionStatus::Pass,
        "fail" => CriterionStatus::Fail,
        other => return Err(rusqlite::Error::FromSqlConversionFailure(
            0, rusqlite::types::Type::Text, format!("status: {other}").into(),
        )),
    };
    let source_str: String = row.get("source")?;
    let source = match source_str.as_str() {
        "ai" => CriterionSource::Ai,
        "user" => CriterionSource::User,
        other => return Err(rusqlite::Error::FromSqlConversionFailure(
            0, rusqlite::types::Type::Text, format!("source: {other}").into(),
        )),
    };
    Ok(Criterion {
        id: row.get("id")?,
        card_id: row.get("card_id")?,
        text: row.get("text")?,
        status,
        source,
        evidence: row.get("evidence")?,
        execution_id: row.get("execution_id")?,
        position: row.get("position")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{boards, cards, connection::open_memory};
    use crate::types::{CreateBoard, CreateCard};

    fn setup() -> (rusqlite::Connection, String) {
        let conn = open_memory().unwrap();
        let b = boards::create(&conn, &CreateBoard {
            name: "b".into(), description: "".into(), directory: "/tmp".into(),
            color: None, slug: None, github_url: None,
        }).unwrap();
        let c = cards::create(&conn, &b.id, &CreateCard { title: "c".into(), description: None, tags: None, assignee: None }).unwrap();
        (conn, c.card.id)
    }

    #[test]
    fn add_assigns_position() {
        let (conn, card_id) = setup();
        let a = add(&conn, &card_id, &CreateCriterion { text: "a".into(), source: CriterionSource::User }).unwrap();
        let b = add(&conn, &card_id, &CreateCriterion { text: "b".into(), source: CriterionSource::Ai }).unwrap();
        assert_eq!(a.position, 0);
        assert_eq!(b.position, 1);
    }

    #[test]
    fn reorder_updates_positions() {
        let (conn, card_id) = setup();
        let a = add(&conn, &card_id, &CreateCriterion { text: "a".into(), source: CriterionSource::User }).unwrap();
        let b = add(&conn, &card_id, &CreateCriterion { text: "b".into(), source: CriterionSource::User }).unwrap();
        reorder(&conn, &card_id, &[b.id.clone(), a.id.clone()]).unwrap();
        let list = list_for_card(&conn, &card_id).unwrap();
        assert_eq!(list[0].id, b.id);
        assert_eq!(list[1].id, a.id);
    }
}
```

- [ ] **Step 2: Run + commit**

Run: `cd rust && cargo test -p glue-paste-dev-core db::criteria`
Expected: 2 tests pass.

```bash
git add rust/crates/core/src/db/criteria.rs rust/crates/core/src/db/mod.rs
git commit -m "feat(rust-core): port criteria CRUD"
```

---

### Task 11: Commits CRUD

**Files:**
- Create: `rust/crates/core/src/db/commits.rs`
- Modify: `rust/crates/core/src/db/mod.rs`

Mirrors `packages/core/src/db/commits.ts`. Functions: `list_for_card`, `record`.

- [ ] **Step 1: Add + implement**

Append to `db/mod.rs`:
```rust
pub mod commits;
```

Write `rust/crates/core/src/db/commits.rs`:
```rust
use rusqlite::{params, Connection};

use crate::types::CardCommit;
use crate::Result;

pub struct NewCommit<'a> {
    pub card_id: &'a str,
    pub execution_id: Option<&'a str>,
    pub sha: &'a str,
    pub message: &'a str,
    pub author_name: &'a str,
    pub author_email: &'a str,
    pub files_changed: Option<&'a str>,
}

pub fn record(conn: &Connection, c: &NewCommit) -> Result<CardCommit> {
    let row = conn.query_row(
        "INSERT INTO card_commits (card_id, execution_id, sha, message, author_name, author_email, files_changed)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING *",
        params![c.card_id, c.execution_id, c.sha, c.message, c.author_name, c.author_email, c.files_changed],
        row_to_commit,
    )?;
    Ok(row)
}

pub fn list_for_card(conn: &Connection, card_id: &str) -> Result<Vec<CardCommit>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM card_commits WHERE card_id = ? ORDER BY created_at DESC",
    )?;
    let rows = stmt
        .query_map([card_id], row_to_commit)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn row_to_commit(row: &rusqlite::Row<'_>) -> rusqlite::Result<CardCommit> {
    Ok(CardCommit {
        id: row.get("id")?,
        card_id: row.get("card_id")?,
        execution_id: row.get("execution_id")?,
        sha: row.get("sha")?,
        message: row.get("message")?,
        author_name: row.get("author_name")?,
        author_email: row.get("author_email")?,
        files_changed: row.get("files_changed")?,
        created_at: row.get("created_at")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{boards, cards, connection::open_memory};
    use crate::types::{CreateBoard, CreateCard};

    #[test]
    fn record_then_list() {
        let conn = open_memory().unwrap();
        let b = boards::create(&conn, &CreateBoard {
            name: "b".into(), description: "".into(), directory: "/tmp".into(),
            color: None, slug: None, github_url: None,
        }).unwrap();
        let c = cards::create(&conn, &b.id, &CreateCard { title: "c".into(), description: None, tags: None, assignee: None }).unwrap();
        record(&conn, &NewCommit {
            card_id: &c.card.id,
            execution_id: None,
            sha: "abc123",
            message: "wip",
            author_name: "Tester",
            author_email: "test@example.com",
            files_changed: Some("a.txt"),
        }).unwrap();
        let list = list_for_card(&conn, &c.card.id).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].sha, "abc123");
    }
}
```

- [ ] **Step 2: Run + commit**

```bash
cd rust && cargo test -p glue-paste-dev-core db::commits
git add rust/crates/core/src/db/commits.rs rust/crates/core/src/db/mod.rs
git commit -m "feat(rust-core): port commits recording"
```

---

### Task 12: Bun-DB ↔ Rust parity integration test

**Files:**
- Create: `rust/crates/core/tests/bun_parity.rs`
- Create: `rust/crates/core/tests/fixtures/bun-created.db` (binary fixture)

Validate the strongest invariant: a database created by the Bun stack opens cleanly in Rust and produces the expected schema/data.

- [ ] **Step 1: Capture a Bun-produced DB fixture**

Run:
```bash
cd packages/core
bun -e "import { getDb, boardsDb, cardsDb } from './src/index.ts';
const db = getDb('/tmp/bun-fixture.db');
const b = boardsDb.createBoard(db, { name:'Fix', description:'', directory:'/tmp', color:null, slug:null, github_url:null });
cardsDb.create(db, b.id, { title:'Task1', description:'', tags:['a','b'], assignee:'ai' });
db.close();"

mkdir -p ../../rust/crates/core/tests/fixtures
cp /tmp/bun-fixture.db ../../rust/crates/core/tests/fixtures/bun-created.db
```

- [ ] **Step 2: Write parity test**

Write `rust/crates/core/tests/bun_parity.rs`:
```rust
use glue_paste_dev_core::db::{boards, cards, connection};

#[test]
fn rust_reads_bun_created_db() {
    let fixture = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/bun-created.db");
    // Copy to tempdir so we don't pollute the fixture with new pragmas
    let tmp = tempfile::tempdir().unwrap();
    let dest = tmp.path().join("copy.db");
    std::fs::copy(&fixture, &dest).unwrap();

    let conn = connection::open_at(&dest).expect("open bun-created db");
    let boards_list = boards::list(&conn).unwrap();
    assert!(!boards_list.is_empty(), "should have at least one board");

    let first = &boards_list[0];
    assert_eq!(first.name, "Fix");

    let (cards_list, _) = cards::list_for_board(&conn, &first.id, 20).unwrap();
    assert_eq!(cards_list.len(), 1);
    assert_eq!(cards_list[0].card.title, "Task1");
    assert_eq!(cards_list[0].tags, vec!["a".to_string(), "b".to_string()]);
}

#[test]
fn rust_created_db_reopens_cleanly() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("rust.db");
    {
        let conn = connection::open_at(&path).unwrap();
        boards::create(&conn, &glue_paste_dev_core::types::CreateBoard {
            name: "R".into(), description: "".into(), directory: "/tmp".into(),
            color: None, slug: None, github_url: None,
        }).unwrap();
    }
    // Re-open: migrations must no-op
    let conn2 = connection::open_at(&path).unwrap();
    let list = boards::list(&conn2).unwrap();
    assert_eq!(list.len(), 1);
}
```

- [ ] **Step 3: Run**

Run: `cd rust && cargo test -p glue-paste-dev-core --test bun_parity`
Expected: 2 tests pass.

- [ ] **Step 4: Commit**

```bash
git add rust/crates/core/tests
git commit -m "test(rust-core): Bun-Rust DB parity integration tests"
```

---

### Task 13: CI hook — generated TS in sync with Rust types

**Files:**
- Modify: `.github/workflows/ci.yml` (or create if missing)
- Create: `scripts/check-generated-types.sh`

Ensure CI fails when the dashboard's generated TS files drift from the Rust definitions.

- [ ] **Step 1: Locate or create CI workflow**

Run: `ls .github/workflows/ 2>/dev/null || echo "missing"`

If missing, write `.github/workflows/ci.yml`:
```yaml
name: CI
on: [push, pull_request]
jobs:
  rust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - name: cargo test
        working-directory: rust
        run: cargo test --workspace
      - name: types in sync
        run: ./scripts/check-generated-types.sh
```

If an existing workflow is present, add a `types in sync` step that runs the script.

- [ ] **Step 2: Write the check script**

Write `scripts/check-generated-types.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
# Regenerate types
cd rust
cargo test -p glue-paste-dev-core --quiet
cd ..
# Fail if any generated file differs from the committed copy
if ! git diff --exit-code packages/dashboard/src/types/generated; then
  echo "ERROR: generated TypeScript types are out of sync with Rust types."
  echo "Run 'cargo test -p glue-paste-dev-core' and commit the changes under"
  echo "packages/dashboard/src/types/generated/."
  exit 1
fi
```

Run: `chmod +x scripts/check-generated-types.sh`

- [ ] **Step 3: Verify locally**

Run: `./scripts/check-generated-types.sh`
Expected: exits 0 (no diff).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml scripts/check-generated-types.sh
git commit -m "ci: enforce ts-rs generated types stay in sync with Rust"
```

---

### Task 14: README — how to work in the new Rust crate

**Files:**
- Create: `rust/README.md`
- Modify: `CLAUDE.md` (add Rust crate type-check command + test command)

- [ ] **Step 1: Write `rust/README.md`**

```markdown
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
```

- [ ] **Step 2: Update root `CLAUDE.md`**

Add to the "TypeScript — Run After Every Change" section a Rust row, and add a Rust testing line:

In the type-check table, append:
```
| `rust/crates/core` | `cd rust && cargo check -p glue-paste-dev-core` |
```

In the testing section, add under "Per package":
```bash
cd rust && cargo test -p glue-paste-dev-core
```

- [ ] **Step 3: Commit**

```bash
git add rust/README.md CLAUDE.md
git commit -m "docs: Rust crate README + CLAUDE.md update"
```

---

## Self-Review

**1. Spec coverage:**
- DB schema port → Task 4 ✓
- Connection + pragmas → Task 3 ✓
- All 9 tables CRUD → Tasks 6 (boards), 7 (cards+tags), 8 (comments), 9 (executions), 10 (criteria), 11 (commits). `card_files` and `config` CRUD intentionally deferred — `card_files` is only read/written by executor logic ported in Phase 2; `config` CRUD ports in Phase 4 alongside the `/api/config` routes (it's mostly read-many-write-once and ties closely to the route layer). Acceptance still satisfied: all tables created by schema, opening Bun DBs works.
- Types with ts-rs → Task 5 ✓
- Bun parity → Task 12 ✓
- CI sync → Task 13 ✓

**2. Placeholder scan:** No TBDs, no "implement later", no "similar to". Every code block is concrete and standalone.

**3. Type consistency:** Field names (e.g. `card_id`, `execution_id`, `cost_usd`) are spelled identically across `types/*.rs`, SQL queries, and `row_to_*` mappers. Enum variants (`CardStatus::InProgress` ↔ SQL `"in-progress"`) consistent across producers/consumers.

**Known gap (acknowledged, not fixed in Phase 1):** `card_files` and `config` table CRUD modules are deferred. Documented above in section 1.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-26-phase-1-rust-core-foundation.md`.

Per project CLAUDE.md auto-select: **Subagent-Driven Development**. Invoke `superpowers:subagent-driven-development` to execute Task 1 first.

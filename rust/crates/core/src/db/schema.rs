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
        "ALTER TABLE config ADD COLUMN terminal_permission_mode TEXT DEFAULT 'auto-unless-watching'",
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

    #[test]
    fn config_has_terminal_permission_mode() {
        let conn = open_memory().expect("open");
        // Column must be present (migration applies on fresh schema since the column
        // is not in SCHEMA_SQL; only the migration adds it).
        let col_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('config') WHERE name = 'terminal_permission_mode'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(col_count, 1);
    }
}

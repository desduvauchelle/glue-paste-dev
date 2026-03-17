import type { Database } from "bun:sqlite";

export function initSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      directory TEXT NOT NULL,
      session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','queued','in-progress','done','failed','rate-limited')),
      position INTEGER NOT NULL DEFAULT 0,
      blocking INTEGER NOT NULL DEFAULT 0,
      thinking_level TEXT DEFAULT NULL,
      plan_mode INTEGER DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS card_tags (
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (card_id, tag)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      author TEXT NOT NULL CHECK(author IN ('user','system','ai')),
      content TEXT NOT NULL,
      execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      pid INTEGER
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      cli_provider TEXT NOT NULL DEFAULT 'claude',
      cli_custom_command TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT 'claude-opus-4-6',
      max_budget_usd REAL NOT NULL DEFAULT 10.0,
      auto_confirm INTEGER NOT NULL DEFAULT 1,
      plan_mode INTEGER NOT NULL DEFAULT 1,
      thinking_level TEXT NOT NULL DEFAULT 'smart',
      custom_tags TEXT NOT NULL DEFAULT '[]',
      custom_instructions TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_cards_board_id ON cards(board_id);
    CREATE INDEX IF NOT EXISTS idx_cards_status ON cards(status);
    CREATE INDEX IF NOT EXISTS idx_comments_card_id ON comments(card_id);
    CREATE INDEX IF NOT EXISTS idx_executions_card_id ON executions(card_id);

    -- Insert default global config if not exists
    INSERT OR IGNORE INTO config (key) VALUES ('global');
  `);

  // Migration: add blocking column if missing (for existing databases)
  try {
    db.exec(`ALTER TABLE cards ADD COLUMN blocking INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: add thinking_level and plan_mode to cards
  try {
    db.exec(`ALTER TABLE cards ADD COLUMN thinking_level TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — ignore
  }
  try {
    db.exec(`ALTER TABLE cards ADD COLUMN plan_mode INTEGER DEFAULT NULL`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: add thinking_level to config
  try {
    db.exec(`ALTER TABLE config ADD COLUMN thinking_level TEXT NOT NULL DEFAULT 'smart'`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: update cards CHECK constraint to include 'rate-limited' status
  // SQLite doesn't allow ALTER CHECK, so we recreate the table if needed
  try {
    // Test if the new status value is accepted
    db.exec(`INSERT INTO cards (id, board_id, title, status) VALUES ('__migration_test__', '__none__', 'test', 'rate-limited')`);
    db.exec(`DELETE FROM cards WHERE id = '__migration_test__'`);
  } catch {
    // Old CHECK constraint rejects 'rate-limited' — recreate the table
    db.exec(`
      CREATE TABLE IF NOT EXISTS cards_new (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','queued','in-progress','done','failed','rate-limited')),
        position INTEGER NOT NULL DEFAULT 0,
        blocking INTEGER NOT NULL DEFAULT 0,
        thinking_level TEXT DEFAULT NULL,
        plan_mode INTEGER DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO cards_new SELECT * FROM cards;
      DROP TABLE cards;
      ALTER TABLE cards_new RENAME TO cards;
      CREATE INDEX IF NOT EXISTS idx_cards_board_id ON cards(board_id);
      CREATE INDEX IF NOT EXISTS idx_cards_status ON cards(status);
    `);
  }

  // Migration: add cli_provider and cli_custom_command to config
  try {
    db.exec(`ALTER TABLE config ADD COLUMN cli_provider TEXT NOT NULL DEFAULT 'claude'`);
  } catch {
    // Column already exists — ignore
  }
  try {
    db.exec(`ALTER TABLE config ADD COLUMN cli_custom_command TEXT NOT NULL DEFAULT ''`);
  } catch {
    // Column already exists — ignore
  }
}

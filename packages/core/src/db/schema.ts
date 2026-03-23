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
      status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','queued','in-progress','done','failed')),
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
      plan_mode INTEGER NOT NULL DEFAULT 1,
      thinking_level TEXT NOT NULL DEFAULT 'smart',
      custom_tags TEXT NOT NULL DEFAULT '[]',
      custom_instructions TEXT NOT NULL DEFAULT ''
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

    CREATE INDEX IF NOT EXISTS idx_cards_board_id ON cards(board_id);
    CREATE INDEX IF NOT EXISTS idx_cards_status ON cards(status);
    CREATE INDEX IF NOT EXISTS idx_comments_card_id ON comments(card_id);
    CREATE INDEX IF NOT EXISTS idx_executions_card_id ON executions(card_id);
    CREATE INDEX IF NOT EXISTS idx_card_files_card_id ON card_files(card_id);
    CREATE INDEX IF NOT EXISTS idx_card_commits_card_id ON card_commits(card_id);

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

  // Migration: remove 'rate-limited' status — move any such cards to 'todo'
  // and recreate table with updated CHECK constraint
  try {
    // Test if old schema still accepts 'rate-limited' by temporarily disabling FK checks
    db.exec(`PRAGMA foreign_keys = OFF`);
    db.exec(`INSERT INTO cards (id, board_id, title, status) VALUES ('__migration_test__', '__none__', 'test', 'rate-limited')`);
    db.exec(`DELETE FROM cards WHERE id = '__migration_test__'`);
    // Old schema still accepts 'rate-limited' — migrate the table
    db.exec(`UPDATE cards SET status = 'todo' WHERE status = 'rate-limited'`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS cards_new (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','queued','in-progress','done','failed')),
        position INTEGER NOT NULL DEFAULT 0,
        blocking INTEGER NOT NULL DEFAULT 0,
        thinking_level TEXT DEFAULT NULL,
        plan_mode INTEGER DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO cards_new (id, board_id, title, description, status, position, blocking, thinking_level, plan_mode, created_at, updated_at)
        SELECT id, board_id, title, description, status, position, blocking, thinking_level, plan_mode, created_at, updated_at FROM cards;
      DROP TABLE cards;
      ALTER TABLE cards_new RENAME TO cards;
      CREATE INDEX IF NOT EXISTS idx_cards_board_id ON cards(board_id);
      CREATE INDEX IF NOT EXISTS idx_cards_status ON cards(status);
    `);
    db.exec(`PRAGMA foreign_keys = ON`);
  } catch {
    // New schema already in place — no migration needed
    db.exec(`PRAGMA foreign_keys = ON`);
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

  // Migration: add color to boards
  try {
    db.exec(`ALTER TABLE boards ADD COLUMN color TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: replace thinking_level + plan_mode with plan_thinking + execute_thinking
  try {
    db.exec(`ALTER TABLE cards ADD COLUMN plan_thinking TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — ignore
  }
  try {
    db.exec(`ALTER TABLE cards ADD COLUMN execute_thinking TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — ignore
  }
  try {
    db.exec(`ALTER TABLE config ADD COLUMN plan_thinking TEXT DEFAULT 'smart'`);
  } catch {
    // Column already exists — ignore
  }
  try {
    db.exec(`ALTER TABLE config ADD COLUMN execute_thinking TEXT NOT NULL DEFAULT 'smart'`);
  } catch {
    // Column already exists — ignore
  }
  // Migrate existing data from old columns to new columns
  try {
    db.exec(`UPDATE cards SET plan_thinking = thinking_level WHERE plan_thinking IS NULL AND thinking_level IS NOT NULL AND (plan_mode IS NULL OR plan_mode != 0)`);
    db.exec(`UPDATE cards SET execute_thinking = thinking_level WHERE execute_thinking IS NULL AND thinking_level IS NOT NULL`);
    db.exec(`UPDATE config SET plan_thinking = CASE WHEN plan_mode = 0 THEN NULL ELSE thinking_level END WHERE plan_thinking = 'smart' AND thinking_level != 'smart'`);
    db.exec(`UPDATE config SET execute_thinking = thinking_level WHERE execute_thinking = 'smart' AND thinking_level != 'smart'`);
  } catch {
    // Migration already applied or old columns don't exist
  }

  // Migration: add auto_commit to config
  try {
    db.exec(`ALTER TABLE config ADD COLUMN auto_commit INTEGER NOT NULL DEFAULT 1`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: add auto_commit to cards
  try {
    db.exec(`ALTER TABLE cards ADD COLUMN auto_commit INTEGER DEFAULT NULL`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: add plan_model and execute_model to config
  try {
    db.exec(`ALTER TABLE config ADD COLUMN plan_model TEXT NOT NULL DEFAULT ''`);
  } catch {
    // Column already exists — ignore
  }
  try {
    db.exec(`ALTER TABLE config ADD COLUMN execute_model TEXT NOT NULL DEFAULT ''`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: add auto_push to config
  try {
    db.exec(`ALTER TABLE config ADD COLUMN auto_push INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: add auto_push to cards
  try {
    db.exec(`ALTER TABLE cards ADD COLUMN auto_push INTEGER DEFAULT NULL`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: change auto_commit default to 0
  // (only affects new rows via the schema; existing rows keep their values)

  // Migration: add files_changed to executions
  try {
    db.exec(`ALTER TABLE executions ADD COLUMN files_changed TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: add assignee column to cards
  try {
    db.exec(`ALTER TABLE cards ADD COLUMN assignee TEXT NOT NULL DEFAULT 'ai'`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: add scratchpad to boards
  try {
    db.exec(`ALTER TABLE boards ADD COLUMN scratchpad TEXT NOT NULL DEFAULT ''`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: add slug to boards
  try {
    db.exec(`ALTER TABLE boards ADD COLUMN slug TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — ignore
  }
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_boards_slug ON boards(slug) WHERE slug IS NOT NULL`);
  } catch {
    // Index already exists — ignore
  }

  // Migration: allow NULLs in config table for project-level inheritance
  // Project configs use NULL to mean "inherit from global"
  try {
    // Check if migration is needed by testing if a NULL insert works
    db.exec(`PRAGMA foreign_keys = OFF`);
    db.exec(`INSERT INTO config (key, cli_provider) VALUES ('__null_test__', NULL)`);
    // If we get here, NULLs are already allowed — clean up
    db.exec(`DELETE FROM config WHERE key = '__null_test__'`);
    db.exec(`PRAGMA foreign_keys = ON`);
  } catch {
    // NOT NULL constraint fired — need to recreate table
    db.exec(`DELETE FROM config WHERE key = '__null_test__'`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS config_new (
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
        auto_push INTEGER DEFAULT 0
      );
      INSERT INTO config_new (key, cli_provider, cli_custom_command, model, max_budget_usd, plan_mode, thinking_level, custom_tags, custom_instructions, plan_thinking, execute_thinking, auto_commit, plan_model, execute_model, auto_push)
        SELECT key, cli_provider, cli_custom_command, model, max_budget_usd, plan_mode, thinking_level, custom_tags, custom_instructions, plan_thinking, execute_thinking, auto_commit, plan_model, execute_model, auto_push FROM config;
      DROP TABLE config;
      ALTER TABLE config_new RENAME TO config;
    `);
    db.exec(`PRAGMA foreign_keys = ON`);
  }

  // Migration: add github_url to boards
  try {
    db.exec(`ALTER TABLE boards ADD COLUMN github_url TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: add card_commits table for existing databases
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS card_commits (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
      sha TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      author_name TEXT NOT NULL DEFAULT '',
      author_email TEXT NOT NULL DEFAULT '',
      files_changed TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_card_commits_card_id ON card_commits(card_id)`);
  } catch {
    // Table already exists — ignore
  }

  // Migration: add branch_mode and branch_name to config
  try {
    db.exec(`ALTER TABLE config ADD COLUMN branch_mode TEXT DEFAULT 'current'`);
  } catch {
    // Column already exists — ignore
  }
  try {
    db.exec(`ALTER TABLE config ADD COLUMN branch_name TEXT DEFAULT ''`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: add cli_provider, cli_custom_command, branch_mode, branch_name to cards
  try {
    db.exec(`ALTER TABLE cards ADD COLUMN cli_provider TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — ignore
  }
  try {
    db.exec(`ALTER TABLE cards ADD COLUMN cli_custom_command TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — ignore
  }
  try {
    db.exec(`ALTER TABLE cards ADD COLUMN branch_mode TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — ignore
  }
  try {
    db.exec(`ALTER TABLE cards ADD COLUMN branch_name TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — ignore
  }
}

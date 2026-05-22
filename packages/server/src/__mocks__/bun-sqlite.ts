// Vitest mock for bun:sqlite — allows server tests to run under Node.js/Vitest
// Uses node:sqlite (Node 22+) with a thin adapter to match Bun's Database API.
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

export class Database {
  private _db: DatabaseSync;

  constructor(path?: string) {
    this._db = new DatabaseSync(path ?? ":memory:");
  }

  exec(sql: string): void {
    this._db.exec(sql);
  }

  prepare(sql: string) {
    const stmt = this._db.prepare(sql);
    return {
      run: (...params: unknown[]) => {
        const result = stmt.run(...(params as SQLInputValue[]));
        return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
      },
      get: (...params: unknown[]) => {
        const row = stmt.get(...(params as SQLInputValue[]));
        return row ? Object.assign({}, row) : null;
      },
      all: (...params: unknown[]) => {
        const rows = stmt.all(...(params as SQLInputValue[]));
        return rows.map((r: unknown) => Object.assign({}, r));
      },
    };
  }

  /** Bun SQLite uses query() as an alias for prepare() */
  query(sql: string) {
    return this.prepare(sql);
  }

  /** Simple transaction shim — node:sqlite lacks db.transaction(), so run inline */
  transaction(fn: () => void): () => void {
    return () => {
      this._db.exec("BEGIN");
      try {
        fn();
        this._db.exec("COMMIT");
      } catch (err) {
        this._db.exec("ROLLBACK");
        throw err;
      }
    };
  }

  close(): void {
    this._db.close();
  }
}

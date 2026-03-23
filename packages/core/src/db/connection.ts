import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { initSchema } from "./schema.js";

const DATA_DIR = join(homedir(), ".glue-paste-dev");
const DB_PATH = join(DATA_DIR, "glue-paste-dev.db");

let db: Database | null = null;

export function getDataDir(): string {
  return DATA_DIR;
}

export function getDb(dbPath?: string): Database {
  if (db) return db;

  const path = dbPath ?? DB_PATH;
  const dir = join(path, "..");
  mkdirSync(dir, { recursive: true });

  db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA cache_size = -2000"); // 2MB cache (negative = KB)
  db.exec("PRAGMA mmap_size = 64000000"); // 64MB mmap — lets OS page data efficiently

  initSchema(db);

  return db;
}

/** For testing: create an in-memory database */
export function getTestDb(): Database {
  const testDb = new Database(":memory:");
  testDb.exec("PRAGMA foreign_keys = ON");
  initSchema(testDb);
  return testDb;
}

/** Close the singleton database connection */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

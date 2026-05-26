import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../db/schema.js";

let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  initSchema(db);
});

describe("schema: criteria + card columns", () => {
  it("creates card_criteria table", () => {
    const cols = db.query("PRAGMA table_info(card_criteria)").all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain("status");
    expect(names).toContain("evidence");
    expect(names).toContain("execution_id");
    expect(names).toContain("position");
  });

  it("adds plan_summary, completion_summary, blocker columns to cards", () => {
    const cols = db.query("PRAGMA table_info(cards)").all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain("plan_summary");
    expect(names).toContain("completion_summary");
    expect(names).toContain("blocker");
  });
});

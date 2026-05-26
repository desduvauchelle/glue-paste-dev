import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../db/schema.js";
import { createBoard } from "../../db/boards.js";
import {
  createCard,
  getCard,
  setPlanSummary,
  setCompletionSummary,
  setBlocker,
} from "../../db/cards.js";
import { seedCriteria } from "../../db/criteria.js";
import type { BoardId, CardId } from "../../types/index.js";

let db: Database;
let cardId: CardId;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  initSchema(db);
  const board = createBoard(db, { name: "T", description: "", directory: "/tmp/t" });
  const card = createCard(db, board.id as BoardId, { title: "Card", tags: [] });
  cardId = card.id as CardId;
});

describe("card artifact hydration", () => {
  it("hydrates criteria, plan_summary, completion_summary, blocker", () => {
    seedCriteria(db, cardId, ["builds", "tests pass"]);
    setPlanSummary(db, cardId, { key_files: ["a.ts"], risks: ["risk"], dependencies: [] });
    setCompletionSummary(db, cardId, "shipped X");
    setBlocker(db, cardId, { type: "git", root_cause: "conflict", resolution_route: "rebase" });

    const card = getCard(db, cardId)!;
    expect(card.criteria).toHaveLength(2);
    expect(card.plan_summary?.key_files).toEqual(["a.ts"]);
    expect(card.completion_summary).toBe("shipped X");
    expect(card.blocker?.type).toBe("git");
  });

  it("defaults artifacts to empty/null on a fresh card", () => {
    const card = getCard(db, cardId)!;
    expect(card.criteria).toEqual([]);
    expect(card.plan_summary).toBeNull();
    expect(card.completion_summary).toBeNull();
    expect(card.blocker).toBeNull();
  });
});

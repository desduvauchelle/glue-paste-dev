import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../db/schema.js";
import { createBoard } from "../../db/boards.js";
import { createCard } from "../../db/cards.js";
import {
  getCriteria,
  getCriterion,
  seedCriteria,
  setCriterionResult,
  createCriterion,
  updateCriterion,
  deleteCriterion,
  reorderCriteria,
} from "../../db/criteria.js";
import type { BoardId, CardId, CriterionId } from "../../types/index.js";

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

describe("criteria db", () => {
  it("seeds criteria only when none exist", () => {
    const first = seedCriteria(db, cardId, ["a", "b"]);
    expect(first).toHaveLength(2);
    expect(first[0]!.source).toBe("ai");
    const second = seedCriteria(db, cardId, ["c"]);
    expect(second).toHaveLength(2); // unchanged — already seeded
  });

  it("sets a verdict + evidence by id", () => {
    const [c] = seedCriteria(db, cardId, ["builds"]);
    setCriterionResult(db, c!.id as CriterionId, "pass", "tests green", null);
    const got = getCriterion(db, c!.id as CriterionId);
    expect(got?.status).toBe("pass");
    expect(got?.evidence).toBe("tests green");
  });

  it("supports manual create/update/delete", () => {
    const created = createCriterion(db, cardId, "manual one");
    expect(created.source).toBe("user");
    updateCriterion(db, created.id as CriterionId, { text: "edited", status: "fail" });
    const after = getCriterion(db, created.id as CriterionId);
    expect(after?.text).toBe("edited");
    expect(after?.status).toBe("fail");
    expect(deleteCriterion(db, created.id as CriterionId)).toBe(true);
    expect(getCriterion(db, created.id as CriterionId)).toBeNull();
  });

  it("reorders criteria", () => {
    const seeded = seedCriteria(db, cardId, ["a", "b"]);
    reorderCriteria(db, [
      { id: seeded[1]!.id as CriterionId, position: 0 },
      { id: seeded[0]!.id as CriterionId, position: 1 },
    ]);
    const ordered = getCriteria(db, cardId);
    expect(ordered[0]!.text).toBe("b");
  });
});

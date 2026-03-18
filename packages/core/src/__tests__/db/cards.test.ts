import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../db/schema.js";
import { createBoard } from "../../db/boards.js";
import {
  listCards,
  getCard,
  createCard,
  updateCard,
  moveCard,
  deleteCard,
  updateCardStatus,
  resetStaleCards,
  recoverInterruptedCards,
  getDistinctTags,
  listCardsByStatus,
} from "../../db/cards.js";
import { createExecution, getCompletedPlanOutput, updateExecutionStatus } from "../../db/executions.js";
import type { BoardId, CardId, ExecutionId } from "../../types/index.js";

let db: Database;
let boardId: BoardId;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  initSchema(db);

  const board = createBoard(db, {
    name: "Test Board",
    description: "",
    directory: "/tmp/test",
  });
  boardId = board.id as BoardId;
});

describe("cards", () => {
  it("should create a card with tags", () => {
    const card = createCard(db, boardId, {
      title: "Build login page",
      description: "Create a login page with OAuth",
      tags: ["UX", "backend"],
    });

    expect(card.title).toBe("Build login page");
    expect(card.tags).toEqual(["UX", "backend"]);
    expect(card.status).toBe("todo");
  });

  it("should auto-increment position", () => {
    const card1 = createCard(db, boardId, {
      title: "Card 1",
      description: "",
      tags: [],
    });
    const card2 = createCard(db, boardId, {
      title: "Card 2",
      description: "",
      tags: [],
    });

    expect(card1.position).toBe(0);
    expect(card2.position).toBe(1);
  });

  it("should list cards for a board", () => {
    createCard(db, boardId, { title: "Card 1", description: "", tags: [] });
    createCard(db, boardId, { title: "Card 2", description: "", tags: [] });

    const cards = listCards(db, boardId);
    expect(cards).toHaveLength(2);
  });

  it("should list cards by status", () => {
    createCard(db, boardId, { title: "Todo", description: "", tags: [] });
    const card2 = createCard(db, boardId, { title: "Done", description: "", tags: [] });
    updateCardStatus(db, card2.id as CardId, "done");

    const todoCards = listCardsByStatus(db, boardId, "todo");
    expect(todoCards).toHaveLength(1);
    expect(todoCards[0]?.title).toBe("Todo");
  });

  it("should update card and tags", () => {
    const card = createCard(db, boardId, {
      title: "Original",
      description: "",
      tags: ["UX"],
    });

    const updated = updateCard(db, card.id as CardId, {
      title: "Updated",
      tags: ["backend", "logic"],
    });

    expect(updated?.title).toBe("Updated");
    expect(updated?.tags).toEqual(["backend", "logic"]);
  });

  it("should move a card", () => {
    const card = createCard(db, boardId, {
      title: "Movable",
      description: "",
      tags: [],
    });

    const moved = moveCard(db, card.id as CardId, {
      status: "in-progress",
      position: 0,
    });

    expect(moved?.status).toBe("in-progress");
  });

  it("should delete a card (cascades tags)", () => {
    const card = createCard(db, boardId, {
      title: "Delete Me",
      description: "",
      tags: ["UX", "design"],
    });

    expect(deleteCard(db, card.id as CardId)).toBe(true);
    expect(getCard(db, card.id as CardId)).toBeNull();
  });

  it("should reset stale cards", () => {
    const card1 = createCard(db, boardId, { title: "C1", description: "", tags: [] });
    const card2 = createCard(db, boardId, { title: "C2", description: "", tags: [] });
    updateCardStatus(db, card1.id as CardId, "in-progress");
    updateCardStatus(db, card2.id as CardId, "queued");

    const resetCount = resetStaleCards(db);
    expect(resetCount).toBe(2);

    const c1 = getCard(db, card1.id as CardId);
    const c2 = getCard(db, card2.id as CardId);
    expect(c1?.status).toBe("todo");
    expect(c2?.status).toBe("todo");
  });

  it("should get distinct tags for a board", () => {
    createCard(db, boardId, { title: "C1", description: "", tags: ["UX", "backend"] });
    createCard(db, boardId, { title: "C2", description: "", tags: ["UX", "design"] });

    const tags = getDistinctTags(db, boardId);
    expect(tags).toEqual(["UX", "backend", "design"]);
  });

  it("should recover interrupted card with no plan → todo", () => {
    const card = createCard(db, boardId, { title: "No plan", description: "", tags: [] });
    updateCardStatus(db, card.id as CardId, "in-progress");
    // Create a running execution (simulates crash mid-execute)
    createExecution(db, card.id as CardId, "session-1", "execute");

    const result = recoverInterruptedCards(db);
    expect(result.reset).toBe(1);
    expect(result.requeued).toBe(0);

    const recovered = getCard(db, card.id as CardId);
    expect(recovered?.status).toBe("todo");
  });

  it("should recover interrupted card with completed plan → queued", () => {
    const card = createCard(db, boardId, { title: "Has plan", description: "", tags: [] });
    updateCardStatus(db, card.id as CardId, "in-progress");

    // Create a successful plan execution
    const planExec = createExecution(db, card.id as CardId, "session-1", "plan");
    updateExecutionStatus(db, planExec.id as ExecutionId, "success", 0);
    // Simulate plan output
    db.query("UPDATE executions SET output = ? WHERE id = ?").run("Plan output here", planExec.id);

    // Create a running execute execution (simulates crash mid-execute)
    createExecution(db, card.id as CardId, "session-2", "execute");

    const result = recoverInterruptedCards(db);
    expect(result.reset).toBe(0);
    expect(result.requeued).toBe(1);

    const recovered = getCard(db, card.id as CardId);
    expect(recovered?.status).toBe("queued");
  });

  it("should retrieve completed plan output", () => {
    const card = createCard(db, boardId, { title: "Plan test", description: "", tags: [] });

    // No plan yet
    expect(getCompletedPlanOutput(db, card.id as CardId)).toBeNull();

    // Add successful plan
    const planExec = createExecution(db, card.id as CardId, "session-1", "plan");
    updateExecutionStatus(db, planExec.id as ExecutionId, "success", 0);
    db.query("UPDATE executions SET output = ? WHERE id = ?").run("The plan", planExec.id);

    expect(getCompletedPlanOutput(db, card.id as CardId)).toBe("The plan");
  });
});

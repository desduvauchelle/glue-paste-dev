import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../db/schema.js";
import { createBoard } from "../../db/boards.js";
import { createCard, updateCardStatus, listCardsByStatus } from "../../db/cards.js";
import { startQueue, executeSingleCard } from "../../executor/queue.js";
import type { BoardId, CardId } from "../../types/index.js";
import type { QueueCallbacks } from "../../executor/queue.js";

let db: Database;
let boardId: BoardId;

function makeCallbacks(): QueueCallbacks {
  return {
    onQueueUpdated: mock(() => {}),
    onQueueStopped: mock(() => {}),
    onCardUpdated: mock(() => {}),
    onExecutionStarted: mock(() => {}),
    onOutput: mock(() => {}),
    onExecutionCompleted: mock(() => {}),
    onCommentAdded: mock(() => {}),
  };
}

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

describe("queue ignores todo cards", () => {
  it("startQueue should not pick up todo cards", async () => {
    const todoCard = createCard(db, boardId, { title: "Todo card", description: "backlog item", tags: [] });
    const queuedCard = createCard(db, boardId, { title: "Queued card", description: "ready to go", tags: [] });
    updateCardStatus(db, queuedCard.id as CardId, "queued");

    const callbacks = makeCallbacks();
    const queueUpdatedCalls: Array<{ queue: string[]; current: string | null }> = [];
    callbacks.onQueueUpdated = mock((_boardId: string, queue: string[], current: string | null) => {
      queueUpdatedCalls.push({ queue, current });
    });

    try {
      await startQueue(db, boardId, callbacks);
    } catch {
      // Runner will fail without real CLI — that's fine
    }

    expect(queueUpdatedCalls.length).toBeGreaterThan(0);
    const firstUpdate = queueUpdatedCalls[0]!;
    expect(firstUpdate.current).toBe(queuedCard.id);
    for (const call of queueUpdatedCalls) {
      expect(call.current).not.toBe(todoCard.id);
      expect(call.queue).not.toContain(todoCard.id);
    }
  });

  it("startQueue with only todo cards should stop with 'no queued cards'", async () => {
    createCard(db, boardId, { title: "Todo 1", description: "", tags: [] });
    createCard(db, boardId, { title: "Todo 2", description: "", tags: [] });

    const callbacks = makeCallbacks();
    let stoppedReason = "";
    callbacks.onQueueStopped = mock((_boardId: string, reason: string) => {
      stoppedReason = reason;
    });

    await startQueue(db, boardId, callbacks);

    expect(stoppedReason).toBe("No queued cards to execute");
  });

  it("listCardsByStatus('queued') should never return todo cards", () => {
    const queuedCard = createCard(db, boardId, { title: "Queued", description: "", tags: [] });
    updateCardStatus(db, queuedCard.id as CardId, "queued");
    const todoCard = createCard(db, boardId, { title: "Todo", description: "", tags: [] });

    const queuedCards = listCardsByStatus(db, boardId, "queued");
    const queuedIds = queuedCards.map((c) => c.id);

    expect(queuedIds).toContain(queuedCard.id);
    expect(queuedIds).not.toContain(todoCard.id);
  });
});

describe("executeSingleCard ignores todo cards", () => {
  it("should throw when trying to execute a todo card", async () => {
    const todoCard = createCard(db, boardId, { title: "Backlog item", description: "", tags: [] });
    const callbacks = makeCallbacks();

    expect(executeSingleCard(db, todoCard.id as CardId, callbacks)).rejects.toThrow("todo");
  });
});

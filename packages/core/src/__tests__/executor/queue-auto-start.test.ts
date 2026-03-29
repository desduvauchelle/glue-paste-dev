import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../db/schema.js";
import { createBoard } from "../../db/boards.js";
import { createCard, updateCardStatus, getCard } from "../../db/cards.js";
import { notifyNewCard, getQueueState, startQueue, stopQueue, pauseQueue } from "../../executor/queue.js";
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

describe("notifyNewCard auto-starts queue when idle", () => {
  it("should start the queue when no queue is running and a queued card exists", async () => {
    const card = createCard(db, boardId, { title: "New task", description: "do something", tags: [] });
    updateCardStatus(db, card.id as CardId, "queued");

    const callbacks = makeCallbacks();
    const queueUpdatedCalls: Array<{ queue: string[]; current: string | null }> = [];
    callbacks.onQueueUpdated = mock((_boardId: string, queue: string[], current: string | null) => {
      queueUpdatedCalls.push({ queue, current });
    });

    // Verify queue is not running before notify
    expect(getQueueState(boardId).isRunning).toBe(false);

    // notifyNewCard should auto-start the queue
    notifyNewCard(db, boardId, callbacks);

    // Give the async startQueue a moment to begin
    await new Promise((r) => setTimeout(r, 50));

    // Queue should have started and picked up the card
    expect(queueUpdatedCalls.length).toBeGreaterThan(0);
    expect(queueUpdatedCalls[0]!.current).toBe(card.id);
  });

  it("should not start the queue for human-assigned cards", async () => {
    const card = createCard(db, boardId, { title: "Human task", description: "", tags: [], assignee: "human" });
    updateCardStatus(db, card.id as CardId, "queued");

    const callbacks = makeCallbacks();
    let stoppedReason = "";
    callbacks.onQueueStopped = mock((_boardId: string, reason: string) => {
      stoppedReason = reason;
    });

    notifyNewCard(db, boardId, callbacks);
    await new Promise((r) => setTimeout(r, 50));

    // Queue should have stopped immediately — no non-human cards to process
    expect(stoppedReason).toBe("No queued cards to execute");
  });

  it("should not auto-start when the queue is paused", () => {
    // First start and pause a queue
    const card1 = createCard(db, boardId, { title: "First", description: "", tags: [] });
    updateCardStatus(db, card1.id as CardId, "queued");

    const callbacks = makeCallbacks();

    // Manually set up a paused queue state by starting then pausing
    // We need at least one queued card to start the queue
    void startQueue(db, boardId, callbacks);

    // Pause the queue (the startQueue sets isRunning=true)
    pauseQueue(boardId, callbacks);
    expect(getQueueState(boardId).isPaused).toBe(true);

    // Create another card and notify
    const card2 = createCard(db, boardId, { title: "Second", description: "", tags: [] });
    updateCardStatus(db, card2.id as CardId, "queued");

    const queueUpdatedCalls: string[] = [];
    const pausedCallbacks = {
      ...callbacks,
      onQueueUpdated: mock(() => { queueUpdatedCalls.push("updated"); }),
    };

    // notifyNewCard should return early (paused), not start a new queue
    notifyNewCard(db, boardId, pausedCallbacks);

    // Queue should still be paused, no new updates from notifyNewCard
    expect(getQueueState(boardId).isPaused).toBe(true);

    // Clean up
    stopQueue(boardId, callbacks);
  });

  it("should do nothing when called with a board that has no queued cards", async () => {
    // No cards at all — notifyNewCard triggers startQueue which finds nothing
    const callbacks = makeCallbacks();
    let stoppedReason = "";
    callbacks.onQueueStopped = mock((_boardId: string, reason: string) => {
      stoppedReason = reason;
    });

    notifyNewCard(db, boardId, callbacks);
    await new Promise((r) => setTimeout(r, 50));

    expect(stoppedReason).toBe("No queued cards to execute");
  });
});

import { describe, test, expect, beforeEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../db/schema.js";
import { createBoard } from "../../db/boards.js";
import {
  createCard,
  getCard,
  listCardsByStatus,
  updateCardStatus,
} from "../../db/cards.js";
import type { BoardId, CardId, CardWithTags } from "../../types/index.js";
import type { QueueCallbacks } from "../../executor/queue.js";
import type { RunResult } from "../../executor/runner.js";

// --- Mock runCard ---
let mockRunCardBehavior: (card: CardWithTags) => Promise<RunResult>;

mock.module("../../executor/runner.js", () => ({
  runCard: async (db: Database, card: CardWithTags, ..._rest: unknown[]) => {
    updateCardStatus(db, card.id as CardId, "in-progress");
    return mockRunCardBehavior(card);
  },
  killCardProcess: () => false,
}));

const { startQueue, executeSingleCard, getQueueState, pauseQueue, resumeQueue } = await import("../../executor/queue.js");

let db: Database;
let boardId: BoardId;
let events: Array<{ type: string; payload?: unknown }>;

// advanceQueue uses `void processQueue()` (fire-and-forget), so
// `await startQueue` only waits for the first card. This helper
// returns a `completed` promise that resolves when onQueueStopped fires.
function makeCallbacksWithCompletion() {
  let resolveCompletion: () => void;
  const completed = new Promise<void>((r) => {
    resolveCompletion = r;
  });

  const callbacks: QueueCallbacks = {
    onQueueUpdated: (bid, queue, current, isPaused) => {
      events.push({
        type: "queue:updated",
        payload: { boardId: bid, queue, current, isPaused },
      });
    },
    onQueueStopped: (bid, reason) => {
      events.push({ type: "queue:stopped", payload: { boardId: bid, reason } });
      resolveCompletion();
    },
    onExecutionStarted: () => {},
    onOutput: () => {},
    onExecutionCompleted: () => {},
    onCardUpdated: (card) => {
      events.push({
        type: "card:updated",
        payload: { id: card.id, status: card.status },
      });
    },
    onCommentAdded: () => {},
  };

  return { callbacks, completed };
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
  events = [];
  mockRunCardBehavior = async () => ({
    success: true,
    exitCode: 0,
    output: "done",
  });
});

describe("startQueue", () => {
  test("fires onQueueStopped when no queued cards exist", async () => {
    const { callbacks, completed } = makeCallbacksWithCompletion();
    await startQueue(db, boardId, callbacks);
    await completed;
    expect(events.some((e) => e.type === "queue:stopped")).toBe(true);
  });

  test("skips human-assigned cards and stops if no AI cards", async () => {
    createCard(db, boardId, {
      title: "Human Card",
      description: "",
      tags: [],
      status: "queued",
      assignee: "human",
    });
    const { callbacks, completed } = makeCallbacksWithCompletion();
    await startQueue(db, boardId, callbacks);
    await completed;
    expect(events.some((e) => e.type === "queue:stopped")).toBe(true);
  });

  test("ignores todo cards — only processes queued status", async () => {
    createCard(db, boardId, {
      title: "Todo Card",
      description: "",
      tags: [],
      status: "todo",
    });
    const { callbacks, completed } = makeCallbacksWithCompletion();
    await startQueue(db, boardId, callbacks);
    await completed;
    expect(events.some((e) => e.type === "queue:stopped")).toBe(true);
    expect(listCardsByStatus(db, boardId, "todo")).toHaveLength(1);
  });
});

describe("full queue lifecycle", () => {
  test("single card: queued → in-progress → done", async () => {
    const card = createCard(db, boardId, {
      title: "Card 1",
      description: "",
      tags: [],
      status: "queued",
    });

    const { callbacks, completed } = makeCallbacksWithCompletion();
    await startQueue(db, boardId, callbacks);
    await completed;

    const final = getCard(db, card.id as CardId);
    expect(final!.status).toBe("done");
  });

  test("multiple queued cards execute sequentially in position order", async () => {
    const c1 = createCard(db, boardId, {
      title: "First",
      description: "",
      tags: [],
      status: "queued",
    });
    const c2 = createCard(db, boardId, {
      title: "Second",
      description: "",
      tags: [],
      status: "queued",
    });
    const c3 = createCard(db, boardId, {
      title: "Third",
      description: "",
      tags: [],
      status: "queued",
    });

    const executionOrder: string[] = [];
    mockRunCardBehavior = async (card) => {
      executionOrder.push(card.title);
      return { success: true, exitCode: 0, output: "done" };
    };

    const { callbacks, completed } = makeCallbacksWithCompletion();
    await startQueue(db, boardId, callbacks);
    await completed;

    expect(executionOrder).toEqual(["First", "Second", "Third"]);
    expect(getCard(db, c1.id as CardId)!.status).toBe("done");
    expect(getCard(db, c2.id as CardId)!.status).toBe("done");
    expect(getCard(db, c3.id as CardId)!.status).toBe("done");
  });

  test("advanceQueue picks up cards added to DB mid-execution", async () => {
    const c1 = createCard(db, boardId, {
      title: "Original",
      description: "",
      tags: [],
      status: "queued",
    });

    let addedMidExecution = false;
    mockRunCardBehavior = async () => {
      if (!addedMidExecution) {
        createCard(db, boardId, {
          title: "Added Mid-Run",
          description: "",
          tags: [],
          status: "queued",
        });
        addedMidExecution = true;
      }
      return { success: true, exitCode: 0, output: "done" };
    };

    const { callbacks, completed } = makeCallbacksWithCompletion();
    await startQueue(db, boardId, callbacks);
    await completed;

    expect(getCard(db, c1.id as CardId)!.status).toBe("done");
    const allDone = listCardsByStatus(db, boardId, "done");
    expect(allDone).toHaveLength(2);
    expect(allDone.some((c) => c.title === "Added Mid-Run")).toBe(true);
  });

  test("failed non-blocking card: queue continues to next", async () => {
    const c1 = createCard(db, boardId, {
      title: "Fails",
      description: "",
      tags: [],
      status: "queued",
      blocking: false,
    });
    const c2 = createCard(db, boardId, {
      title: "Succeeds",
      description: "",
      tags: [],
      status: "queued",
    });

    let callCount = 0;
    mockRunCardBehavior = async () => {
      callCount++;
      if (callCount <= 2) return { success: false, exitCode: 1, output: "err" };
      return { success: true, exitCode: 0, output: "done" };
    };

    const { callbacks, completed } = makeCallbacksWithCompletion();
    await startQueue(db, boardId, callbacks);
    await completed;

    expect(getCard(db, c1.id as CardId)!.status).toBe("failed");
    expect(getCard(db, c2.id as CardId)!.status).toBe("done");
  });

  test("failed blocking card: stops queue, resets remaining to todo", async () => {
    const c1 = createCard(db, boardId, {
      title: "Blocker",
      description: "",
      tags: [],
      status: "queued",
      blocking: true,
    });
    const c2 = createCard(db, boardId, {
      title: "Follower",
      description: "",
      tags: [],
      status: "queued",
    });

    mockRunCardBehavior = async () => ({
      success: false,
      exitCode: 1,
      output: "err",
    });

    const { callbacks, completed } = makeCallbacksWithCompletion();
    await startQueue(db, boardId, callbacks);
    await completed;

    expect(getCard(db, c1.id as CardId)!.status).toBe("failed");
    expect(getCard(db, c2.id as CardId)!.status).toBe("todo");
    expect(events.some((e) => e.type === "queue:stopped")).toBe(true);
  });
});

describe("card position assignment", () => {
  test("new cards auto-increment position (appended to bottom)", () => {
    const c1 = createCard(db, boardId, { title: "First", description: "", tags: [] });
    const c2 = createCard(db, boardId, { title: "Second", description: "", tags: [] });
    const c3 = createCard(db, boardId, { title: "Third", description: "", tags: [] });
    expect(c1.position).toBe(0);
    expect(c2.position).toBe(1);
    expect(c3.position).toBe(2);
  });

  test("positions are independent per status column", () => {
    const todo1 = createCard(db, boardId, { title: "Todo", description: "", tags: [], status: "todo" });
    const queued1 = createCard(db, boardId, { title: "Queued", description: "", tags: [], status: "queued" });
    expect(todo1.position).toBe(0);
    expect(queued1.position).toBe(0);
  });
});

describe("queue-to-in-progress transitions", () => {
  test("startQueue immediately sets first card as current in queue state", async () => {
    const c1 = createCard(db, boardId, {
      title: "First",
      description: "",
      tags: [],
      status: "queued",
    });
    createCard(db, boardId, {
      title: "Second",
      description: "",
      tags: [],
      status: "queued",
    });

    const { callbacks, completed } = makeCallbacksWithCompletion();
    await startQueue(db, boardId, callbacks);
    await completed;

    // The first queue:updated event should have c1 as current
    const firstUpdate = events.find((e) => e.type === "queue:updated");
    expect(firstUpdate).toBeDefined();
    const payload = firstUpdate!.payload as { current: string | null; queue: string[] };
    expect(payload.current).toBe(c1.id);
  });

  test("after card completes, next queued card becomes current immediately", async () => {
    const c1 = createCard(db, boardId, {
      title: "First",
      description: "",
      tags: [],
      status: "queued",
    });
    const c2 = createCard(db, boardId, {
      title: "Second",
      description: "",
      tags: [],
      status: "queued",
    });

    const { callbacks, completed } = makeCallbacksWithCompletion();
    await startQueue(db, boardId, callbacks);
    await completed;

    // After c1 completes, a queue:updated should show c2 as current
    const updates = events.filter((e) => e.type === "queue:updated");
    const c2AsCurrent = updates.find(
      (e) => (e.payload as { current: string | null }).current === c2.id
    );
    expect(c2AsCurrent).toBeDefined();

    // Both cards should be done
    expect(getCard(db, c1.id as CardId)!.status).toBe("done");
    expect(getCard(db, c2.id as CardId)!.status).toBe("done");
  });

  test("queue with mix of human and AI cards only executes AI cards", async () => {
    const human1 = createCard(db, boardId, {
      title: "Human 1",
      description: "",
      tags: [],
      status: "queued",
      assignee: "human",
    });
    const ai1 = createCard(db, boardId, {
      title: "AI 1",
      description: "",
      tags: [],
      status: "queued",
    });
    const human2 = createCard(db, boardId, {
      title: "Human 2",
      description: "",
      tags: [],
      status: "queued",
      assignee: "human",
    });
    const ai2 = createCard(db, boardId, {
      title: "AI 2",
      description: "",
      tags: [],
      status: "queued",
    });

    const executionOrder: string[] = [];
    mockRunCardBehavior = async (card) => {
      executionOrder.push(card.title);
      return { success: true, exitCode: 0, output: "done" };
    };

    const { callbacks, completed } = makeCallbacksWithCompletion();
    await startQueue(db, boardId, callbacks);
    await completed;

    expect(executionOrder).toEqual(["AI 1", "AI 2"]);
    // Human cards remain queued
    expect(getCard(db, human1.id as CardId)!.status).toBe("queued");
    expect(getCard(db, human2.id as CardId)!.status).toBe("queued");
    // AI cards are done
    expect(getCard(db, ai1.id as CardId)!.status).toBe("done");
    expect(getCard(db, ai2.id as CardId)!.status).toBe("done");
  });

  test("queue completes with no new cards and fires stopped with reason", async () => {
    createCard(db, boardId, {
      title: "Only Card",
      description: "",
      tags: [],
      status: "queued",
    });

    const { callbacks, completed } = makeCallbacksWithCompletion();
    await startQueue(db, boardId, callbacks);
    await completed;

    const stopEvent = events.find((e) => e.type === "queue:stopped");
    expect(stopEvent).toBeDefined();
    expect((stopEvent!.payload as { reason: string }).reason).toBe("All cards completed");
  });
});

describe("single card execution", () => {
  test("executeSingleCard: queued card executes and moves to done", async () => {
    const card = createCard(db, boardId, {
      title: "Single",
      description: "",
      tags: [],
      status: "queued",
    });

    const { callbacks } = makeCallbacksWithCompletion();
    await executeSingleCard(db, card.id as CardId, callbacks);

    expect(getCard(db, card.id as CardId)!.status).toBe("done");
  });

  test("executeSingleCard: rejects todo status cards", async () => {
    const card = createCard(db, boardId, {
      title: "Todo Card",
      description: "",
      tags: [],
      status: "todo",
    });

    const { callbacks } = makeCallbacksWithCompletion();
    expect(executeSingleCard(db, card.id as CardId, callbacks)).rejects.toThrow("todo");
  });

  test("executeSingleCard: failed card retries once then marks failed", async () => {
    const card = createCard(db, boardId, {
      title: "Failing Card",
      description: "",
      tags: [],
      status: "queued",
    });

    let callCount = 0;
    mockRunCardBehavior = async () => {
      callCount++;
      return { success: false, exitCode: 1, output: "err" };
    };

    const { callbacks } = makeCallbacksWithCompletion();
    await executeSingleCard(db, card.id as CardId, callbacks);

    expect(getCard(db, card.id as CardId)!.status).toBe("failed");
    // Should have been called twice (initial + retry)
    expect(callCount).toBe(2);
  });

  test("executeSingleCard: rejects human-assigned cards", async () => {
    const card = createCard(db, boardId, {
      title: "Human Card",
      description: "",
      tags: [],
      status: "queued",
      assignee: "human",
    });

    const { callbacks } = makeCallbacksWithCompletion();
    expect(executeSingleCard(db, card.id as CardId, callbacks)).rejects.toThrow("human");
  });
});

describe("queue pause and resume", () => {
  test("paused queue does not advance to next card", async () => {
    const c1 = createCard(db, boardId, {
      title: "First",
      description: "",
      tags: [],
      status: "queued",
    });
    const c2 = createCard(db, boardId, {
      title: "Second",
      description: "",
      tags: [],
      status: "queued",
    });

    let firstCardRunning = false;
    mockRunCardBehavior = async (card) => {
      if (card.title === "First") {
        firstCardRunning = true;
        // Pause the queue while first card is running
        pauseQueue(boardId, callbacks);
      }
      return { success: true, exitCode: 0, output: "done" };
    };

    const { callbacks, completed } = makeCallbacksWithCompletion();

    // Override onQueueStopped won't fire because queue is paused, not stopped
    // We need a different completion signal
    let resolveTest: () => void;
    const testDone = new Promise<void>((r) => { resolveTest = r; });

    // Track queue:updated events to detect pause
    const originalOnQueueUpdated = callbacks.onQueueUpdated;
    callbacks.onQueueUpdated = (bid, queue, current, isPaused) => {
      originalOnQueueUpdated(bid, queue, current, isPaused);
      if (isPaused && current === null) {
        // Queue is paused after first card completed
        resolveTest();
      }
    };

    await startQueue(db, boardId, callbacks);
    await testDone;

    // First card should be done, second should still be queued
    expect(getCard(db, c1.id as CardId)!.status).toBe("done");
    expect(getCard(db, c2.id as CardId)!.status).toBe("queued");
    expect(getQueueState(boardId).isPaused).toBe(true);
  });

  test("resuming paused queue continues execution", async () => {
    const c1 = createCard(db, boardId, {
      title: "First",
      description: "",
      tags: [],
      status: "queued",
    });
    const c2 = createCard(db, boardId, {
      title: "Second",
      description: "",
      tags: [],
      status: "queued",
    });

    let pausedOnce = false;
    mockRunCardBehavior = async (card) => {
      if (card.title === "First" && !pausedOnce) {
        pausedOnce = true;
        pauseQueue(boardId, callbacks);
      }
      return { success: true, exitCode: 0, output: "done" };
    };

    const { callbacks, completed } = makeCallbacksWithCompletion();

    let resolvedPause: () => void;
    const pauseDetected = new Promise<void>((r) => { resolvedPause = r; });
    const originalOnQueueUpdated = callbacks.onQueueUpdated;
    callbacks.onQueueUpdated = (bid, queue, current, isPaused) => {
      originalOnQueueUpdated(bid, queue, current, isPaused);
      if (isPaused && current === null) {
        resolvedPause();
      }
    };

    await startQueue(db, boardId, callbacks);
    await pauseDetected;

    // First card done, second still queued
    expect(getCard(db, c1.id as CardId)!.status).toBe("done");
    expect(getCard(db, c2.id as CardId)!.status).toBe("queued");

    // Resume the queue
    resumeQueue(db, boardId, callbacks);
    await completed;

    // Now second card should be done too
    expect(getCard(db, c2.id as CardId)!.status).toBe("done");
  });
});

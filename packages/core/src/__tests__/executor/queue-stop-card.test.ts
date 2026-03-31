import { describe, test, expect, beforeEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../db/schema.js";
import { createBoard } from "../../db/boards.js";
import {
  createCard,
  getCard,
  updateCardStatus,
} from "../../db/cards.js";
import type { BoardId, CardId, CardWithTags } from "../../types/index.js";
import type { QueueCallbacks } from "../../executor/queue.js";
import type { RunResult } from "../../executor/runner.js";

// --- Mock runCard (preserve real exports to avoid poisoning module cache for other test files) ---
const realRunner = await import("../../executor/runner.js");
let mockRunCardBehavior: (card: CardWithTags) => Promise<RunResult>;
let runCardCallCount: number;

mock.module("../../executor/runner.js", () => ({
  ...realRunner,
  runCard: async (db: Database, card: CardWithTags, ..._rest: unknown[]) => {
    updateCardStatus(db, card.id as CardId, "in-progress");
    runCardCallCount++;
    return mockRunCardBehavior(card);
  },
  killCardProcess: () => true,
}));

const { startQueue, stopCard, executeSingleCard, getQueueState, isCardStopped } = await import("../../executor/queue.js");

let db: Database;
let boardId: BoardId;
let events: Array<{ type: string; payload?: unknown }>;

function makeCallbacksWithCompletion() {
  let resolveCompletion: () => void;
  const completed = new Promise<void>((r) => {
    resolveCompletion = r;
  });

  const callbacks: QueueCallbacks = {
    onQueueUpdated: (bid, queue, current, isPaused, active) => {
      events.push({
        type: "queue:updated",
        payload: { boardId: bid, queue, current, isPaused, active },
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
  runCardCallCount = 0;
  mockRunCardBehavior = async () => ({
    success: true,
    exitCode: 0,
    output: "done",
  });
});

describe("stopCard prevents requeue and relaunch", () => {
  test("stopped card stays in todo — processCard does not retry", async () => {
    const card = createCard(db, boardId, {
      title: "Card to stop",
      description: "",
      tags: [],
      status: "queued",
    });

    // Simulate: when runCard is called, stop the card mid-execution
    mockRunCardBehavior = async (c) => {
      if (c.id === card.id && runCardCallCount === 1) {
        // Stop the card while it's "running"
        stopCard(db, card.id as CardId, callbacks);
      }
      // Return failure (simulates killed process exiting non-zero)
      return { success: false, exitCode: 1, output: "killed" };
    };

    const { callbacks, completed } = makeCallbacksWithCompletion();
    await startQueue(db, boardId, callbacks);
    await completed;

    // Card should remain in "todo" — NOT "failed" or "in-progress"
    const final = getCard(db, card.id as CardId);
    expect(final!.status).toBe("todo");
    // runCard should have been called only once — no retry
    expect(runCardCallCount).toBe(1);
  });

  test("stopped card is not retried even when first attempt fails", async () => {
    const card = createCard(db, boardId, {
      title: "Fail then stop",
      description: "",
      tags: [],
      status: "queued",
    });

    mockRunCardBehavior = async (c) => {
      // Stop the card on the first call
      if (runCardCallCount === 1) {
        stopCard(db, c.id as CardId, callbacks);
      }
      return { success: false, exitCode: 1, output: "error" };
    };

    const { callbacks, completed } = makeCallbacksWithCompletion();
    await startQueue(db, boardId, callbacks);
    await completed;

    const final = getCard(db, card.id as CardId);
    expect(final!.status).toBe("todo");
    // Should NOT have retried — only 1 call
    expect(runCardCallCount).toBe(1);
  });

  test("stopped card does not override status to done if it somehow succeeds", async () => {
    const card = createCard(db, boardId, {
      title: "Stop during success",
      description: "",
      tags: [],
      status: "queued",
    });

    mockRunCardBehavior = async (c) => {
      // Stop card even though execution "succeeds"
      stopCard(db, c.id as CardId, callbacks);
      return { success: true, exitCode: 0, output: "done" };
    };

    const { callbacks, completed } = makeCallbacksWithCompletion();
    await startQueue(db, boardId, callbacks);
    await completed;

    // Status should remain "todo" from stopCard, not overridden to "done"
    const final = getCard(db, card.id as CardId);
    expect(final!.status).toBe("todo");
  });

  test("other queued cards continue after one card is stopped", async () => {
    const c1 = createCard(db, boardId, {
      title: "Will be stopped",
      description: "",
      tags: [],
      status: "queued",
    });
    const c2 = createCard(db, boardId, {
      title: "Should continue",
      description: "",
      tags: [],
      status: "queued",
    });

    mockRunCardBehavior = async (c) => {
      if (c.id === c1.id) {
        stopCard(db, c1.id as CardId, callbacks);
        return { success: false, exitCode: 1, output: "killed" };
      }
      return { success: true, exitCode: 0, output: "done" };
    };

    const { callbacks, completed } = makeCallbacksWithCompletion();
    await startQueue(db, boardId, callbacks);
    await completed;

    expect(getCard(db, c1.id as CardId)!.status).toBe("todo");
    expect(getCard(db, c2.id as CardId)!.status).toBe("done");
  });

  test("stopCard removes card from active list", async () => {
    const card = createCard(db, boardId, {
      title: "Active card",
      description: "",
      tags: [],
      status: "queued",
    });

    let stoppedDuringRun = false;
    mockRunCardBehavior = async (c) => {
      if (!stoppedDuringRun) {
        stoppedDuringRun = true;
        // Check active list before stop
        const stateBefore = getQueueState(boardId);
        expect(stateBefore.active).toContain(card.id);

        stopCard(db, card.id as CardId, callbacks);

        // Check active list after stop
        const stateAfter = getQueueState(boardId);
        expect(stateAfter.active).not.toContain(card.id);
      }
      return { success: false, exitCode: 1, output: "killed" };
    };

    const { callbacks, completed } = makeCallbacksWithCompletion();
    await startQueue(db, boardId, callbacks);
    await completed;

    expect(getCard(db, card.id as CardId)!.status).toBe("todo");
  });
});

describe("executeSingleCard stop behavior", () => {
  test("stopped single card stays in todo — no retry", async () => {
    const card = createCard(db, boardId, {
      title: "Single stop",
      description: "",
      tags: [],
      status: "queued",
    });

    mockRunCardBehavior = async (c) => {
      stopCard(db, c.id as CardId, callbacks);
      return { success: false, exitCode: 1, output: "killed" };
    };

    const { callbacks } = makeCallbacksWithCompletion();
    await executeSingleCard(db, card.id as CardId, callbacks);

    const final = getCard(db, card.id as CardId);
    expect(final!.status).toBe("todo");
    expect(runCardCallCount).toBe(1);
  });

  test("stopped single card during retry stays in todo", async () => {
    const card = createCard(db, boardId, {
      title: "Stop during retry",
      description: "",
      tags: [],
      status: "queued",
    });

    mockRunCardBehavior = async (c) => {
      // Stop on the second call (retry)
      if (runCardCallCount === 2) {
        stopCard(db, c.id as CardId, callbacks);
      }
      return { success: false, exitCode: 1, output: "error" };
    };

    const { callbacks } = makeCallbacksWithCompletion();
    await executeSingleCard(db, card.id as CardId, callbacks);

    const final = getCard(db, card.id as CardId);
    expect(final!.status).toBe("todo");
    // Two calls: first attempt + retry (stopped during retry)
    expect(runCardCallCount).toBe(2);
  });
});

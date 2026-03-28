import { describe, test, expect, beforeEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../db/schema.js";
import { createBoard } from "../../db/boards.js";
import { createCard, getCard, listCardsByStatus, updateCardStatus } from "../../db/cards.js";
import { updateGlobalConfig } from "../../config/manager.js";
import type { BoardId, CardId, CardWithTags } from "../../types/index.js";
import type { QueueCallbacks } from "../../executor/queue.js";
import type { RunResult } from "../../executor/runner.js";

// --- Mock runCard with controllable resolution ---
type CardResolver = { card: CardWithTags; resolve: (result: RunResult) => void };
let pendingCards: CardResolver[] = [];
let autoResolve = true;

mock.module("../../executor/runner.js", () => ({
  runCard: async (db: Database, card: CardWithTags, ..._rest: unknown[]) => {
    updateCardStatus(db, card.id as CardId, "in-progress");
    if (autoResolve) {
      return { success: true, exitCode: 0, output: "done" } as RunResult;
    }
    return new Promise<RunResult>((resolve) => {
      pendingCards.push({ card, resolve });
    });
  },
  killCardProcess: () => false,
}));

const { startQueue, getQueueState, refreshConcurrency, notifyNewCard } = await import("../../executor/queue.js");

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
  pendingCards = [];
  autoResolve = true;
});

describe("concurrent card execution", () => {
  test("startQueue with maxConcurrentCards=2 launches 2 cards simultaneously", async () => {
    autoResolve = false;

    updateGlobalConfig(db, { maxConcurrentCards: 2 });

    createCard(db, boardId, { title: "Card A", description: "", tags: [], status: "queued" });
    createCard(db, boardId, { title: "Card B", description: "", tags: [], status: "queued" });
    createCard(db, boardId, { title: "Card C", description: "", tags: [], status: "queued" });

    const { callbacks, completed } = makeCallbacksWithCompletion();
    void startQueue(db, boardId, callbacks);

    // Wait for both cards to start
    await new Promise<void>((resolve) => {
      const check = () => {
        if (pendingCards.length >= 2) resolve();
        else setTimeout(check, 10);
      };
      check();
    });

    // 2 cards should be in-progress simultaneously
    expect(pendingCards).toHaveLength(2);
    expect(pendingCards[0]!.card.title).toBe("Card A");
    expect(pendingCards[1]!.card.title).toBe("Card B");

    const state = getQueueState(boardId);
    expect(state.active).toHaveLength(2);

    // Resolve all to clean up
    for (const p of pendingCards) {
      p.resolve({ success: true, exitCode: 0, output: "done" });
    }
    // Wait for card C to start and resolve
    await new Promise<void>((resolve) => {
      const check = () => {
        if (pendingCards.length >= 3) resolve();
        else setTimeout(check, 10);
      };
      check();
    });
    pendingCards[2]!.resolve({ success: true, exitCode: 0, output: "done" });
    await completed;
  });

  test("startQueue with maxConcurrentCards=3 launches all 3 cards", async () => {
    autoResolve = false;

    updateGlobalConfig(db, { maxConcurrentCards: 3 });

    createCard(db, boardId, { title: "Card A", description: "", tags: [], status: "queued" });
    createCard(db, boardId, { title: "Card B", description: "", tags: [], status: "queued" });
    createCard(db, boardId, { title: "Card C", description: "", tags: [], status: "queued" });

    const { callbacks, completed } = makeCallbacksWithCompletion();
    void startQueue(db, boardId, callbacks);

    await new Promise<void>((resolve) => {
      const check = () => {
        if (pendingCards.length >= 3) resolve();
        else setTimeout(check, 10);
      };
      check();
    });

    expect(pendingCards).toHaveLength(3);
    const state = getQueueState(boardId);
    expect(state.active).toHaveLength(3);
    expect(state.queue).toHaveLength(0);

    // Resolve all to clean up
    for (const p of pendingCards) {
      p.resolve({ success: true, exitCode: 0, output: "done" });
    }
    await completed;
  });

  test("fillSlots respects maxConcurrentCards when cards complete", async () => {
    const executionOrder: string[] = [];
    autoResolve = true;

    updateGlobalConfig(db, { maxConcurrentCards: 2 });

    createCard(db, boardId, { title: "Card A", description: "", tags: [], status: "queued" });
    createCard(db, boardId, { title: "Card B", description: "", tags: [], status: "queued" });
    createCard(db, boardId, { title: "Card C", description: "", tags: [], status: "queued" });
    createCard(db, boardId, { title: "Card D", description: "", tags: [], status: "queued" });

    // Track execution
    autoResolve = false;
    const { callbacks, completed } = makeCallbacksWithCompletion();
    void startQueue(db, boardId, callbacks);

    // Wait for first 2 cards to start
    await new Promise<void>((resolve) => {
      const check = () => {
        if (pendingCards.length >= 2) resolve();
        else setTimeout(check, 10);
      };
      check();
    });

    expect(pendingCards).toHaveLength(2);
    executionOrder.push(pendingCards[0]!.card.title, pendingCards[1]!.card.title);

    // Complete first card — should trigger fillSlots and start card C
    pendingCards[0]!.resolve({ success: true, exitCode: 0, output: "done" });

    await new Promise<void>((resolve) => {
      const check = () => {
        if (pendingCards.length >= 3) resolve();
        else setTimeout(check, 10);
      };
      check();
    });

    // Card C started while Card B is still running
    expect(pendingCards[2]!.card.title).toBe("Card C");
    executionOrder.push(pendingCards[2]!.card.title);

    // Complete remaining cards
    pendingCards[1]!.resolve({ success: true, exitCode: 0, output: "done" });
    await new Promise<void>((resolve) => {
      const check = () => {
        if (pendingCards.length >= 4) resolve();
        else setTimeout(check, 10);
      };
      check();
    });
    pendingCards[2]!.resolve({ success: true, exitCode: 0, output: "done" });
    pendingCards[3]!.resolve({ success: true, exitCode: 0, output: "done" });
    await completed;

    expect(executionOrder).toEqual(["Card A", "Card B", "Card C"]);
  });

  test("refreshConcurrency fills new slots when maxConcurrentCards increases mid-run", async () => {
    autoResolve = false;

    // Start with maxConcurrentCards=1
    updateGlobalConfig(db, { maxConcurrentCards: 1 });

    createCard(db, boardId, { title: "Card A", description: "", tags: [], status: "queued" });
    createCard(db, boardId, { title: "Card B", description: "", tags: [], status: "queued" });
    createCard(db, boardId, { title: "Card C", description: "", tags: [], status: "queued" });

    const { callbacks, completed } = makeCallbacksWithCompletion();
    void startQueue(db, boardId, callbacks);

    // Wait for first card to start
    await new Promise<void>((resolve) => {
      const check = () => {
        if (pendingCards.length >= 1) resolve();
        else setTimeout(check, 10);
      };
      check();
    });

    // Only 1 card should be active
    expect(pendingCards).toHaveLength(1);
    expect(pendingCards[0]!.card.title).toBe("Card A");
    expect(getQueueState(boardId).active).toHaveLength(1);

    // Increase concurrency to 2
    updateGlobalConfig(db, { maxConcurrentCards: 2 });

    // Call refreshConcurrency — this is what the config route does
    refreshConcurrency(db, boardId, callbacks);

    // Wait for second card to start
    await new Promise<void>((resolve) => {
      const check = () => {
        if (pendingCards.length >= 2) resolve();
        else setTimeout(check, 10);
      };
      check();
    });

    // Now 2 cards should be active
    expect(pendingCards).toHaveLength(2);
    expect(pendingCards[1]!.card.title).toBe("Card B");
    expect(getQueueState(boardId).active).toHaveLength(2);

    // Resolve all to clean up
    for (const p of pendingCards) {
      p.resolve({ success: true, exitCode: 0, output: "done" });
    }
    await new Promise<void>((resolve) => {
      const check = () => {
        if (pendingCards.length >= 3) resolve();
        else setTimeout(check, 10);
      };
      check();
    });
    pendingCards[2]!.resolve({ success: true, exitCode: 0, output: "done" });
    await completed;
  });

  test("refreshConcurrency is a no-op when queue is not running", () => {
    const { callbacks } = makeCallbacksWithCompletion();
    // No queue started — should not throw
    refreshConcurrency(db, boardId, callbacks);
    expect(getQueueState(boardId).isRunning).toBe(false);
  });
});

describe("card added mid-execution with available slots", () => {
  test("fillSlots picks up DB card when in-memory queue is empty but slots are available", async () => {
    autoResolve = false;

    updateGlobalConfig(db, { maxConcurrentCards: 2 });

    // Start with only 1 card — 1 slot will be open
    createCard(db, boardId, { title: "Card A", description: "", tags: [], status: "queued" });

    const { callbacks, completed } = makeCallbacksWithCompletion();
    void startQueue(db, boardId, callbacks);

    // Wait for Card A to start
    await new Promise<void>((resolve) => {
      const check = () => {
        if (pendingCards.length >= 1) resolve();
        else setTimeout(check, 10);
      };
      check();
    });

    expect(pendingCards).toHaveLength(1);
    expect(getQueueState(boardId).active).toHaveLength(1);

    // Add Card B to DB while Card A is still running
    createCard(db, boardId, { title: "Card B", description: "", tags: [], status: "queued" });

    // Complete Card A — fillSlots should re-check DB and find Card B
    pendingCards[0]!.resolve({ success: true, exitCode: 0, output: "done" });

    // Wait for Card B to start
    await new Promise<void>((resolve) => {
      const check = () => {
        if (pendingCards.length >= 2) resolve();
        else setTimeout(check, 10);
      };
      check();
    });

    expect(pendingCards[1]!.card.title).toBe("Card B");

    // Resolve Card B
    pendingCards[1]!.resolve({ success: true, exitCode: 0, output: "done" });
    await completed;
  });

  test("card added to DB is picked up immediately when a concurrent slot opens", async () => {
    autoResolve = false;

    updateGlobalConfig(db, { maxConcurrentCards: 2 });

    // Start with 2 cards — both slots full
    createCard(db, boardId, { title: "Card A", description: "", tags: [], status: "queued" });
    createCard(db, boardId, { title: "Card B", description: "", tags: [], status: "queued" });

    const { callbacks, completed } = makeCallbacksWithCompletion();
    void startQueue(db, boardId, callbacks);

    // Wait for both to start
    await new Promise<void>((resolve) => {
      const check = () => {
        if (pendingCards.length >= 2) resolve();
        else setTimeout(check, 10);
      };
      check();
    });

    expect(getQueueState(boardId).active).toHaveLength(2);

    // Add Card C to DB while both slots are occupied
    createCard(db, boardId, { title: "Card C", description: "", tags: [], status: "queued" });

    // Complete Card A — opens a slot, fillSlots should re-check DB and start Card C
    pendingCards[0]!.resolve({ success: true, exitCode: 0, output: "done" });

    // Wait for Card C to start
    await new Promise<void>((resolve) => {
      const check = () => {
        if (pendingCards.length >= 3) resolve();
        else setTimeout(check, 10);
      };
      check();
    });

    expect(pendingCards[2]!.card.title).toBe("Card C");
    expect(getQueueState(boardId).active).toHaveLength(2); // B and C active

    // Resolve remaining
    pendingCards[1]!.resolve({ success: true, exitCode: 0, output: "done" });
    pendingCards[2]!.resolve({ success: true, exitCode: 0, output: "done" });
    await completed;
  });

  test("notifyNewCard immediately starts a queued card when slot is available", async () => {
    autoResolve = false;

    updateGlobalConfig(db, { maxConcurrentCards: 2 });

    // Start with 1 card — 1 slot open
    createCard(db, boardId, { title: "Card A", description: "", tags: [], status: "queued" });

    const { callbacks, completed } = makeCallbacksWithCompletion();
    void startQueue(db, boardId, callbacks);

    // Wait for Card A to start
    await new Promise<void>((resolve) => {
      const check = () => {
        if (pendingCards.length >= 1) resolve();
        else setTimeout(check, 10);
      };
      check();
    });

    expect(getQueueState(boardId).active).toHaveLength(1);

    // Add Card B to DB and notify the queue
    createCard(db, boardId, { title: "Card B", description: "", tags: [], status: "queued" });
    notifyNewCard(db, boardId, callbacks);

    // Wait for Card B to start immediately (without Card A completing)
    await new Promise<void>((resolve) => {
      const check = () => {
        if (pendingCards.length >= 2) resolve();
        else setTimeout(check, 10);
      };
      check();
    });

    expect(pendingCards[1]!.card.title).toBe("Card B");
    expect(getQueueState(boardId).active).toHaveLength(2);

    // Resolve all
    for (const p of pendingCards) {
      p.resolve({ success: true, exitCode: 0, output: "done" });
    }
    await completed;
  });

  test("notifyNewCard is a no-op when all slots are full", async () => {
    autoResolve = false;

    updateGlobalConfig(db, { maxConcurrentCards: 1 });

    createCard(db, boardId, { title: "Card A", description: "", tags: [], status: "queued" });

    const { callbacks, completed } = makeCallbacksWithCompletion();
    void startQueue(db, boardId, callbacks);

    // Wait for Card A to start
    await new Promise<void>((resolve) => {
      const check = () => {
        if (pendingCards.length >= 1) resolve();
        else setTimeout(check, 10);
      };
      check();
    });

    // Add Card B and notify — but slot is full, so B should NOT start yet
    createCard(db, boardId, { title: "Card B", description: "", tags: [], status: "queued" });
    notifyNewCard(db, boardId, callbacks);

    // Give it a tick to make sure nothing starts
    await new Promise((r) => setTimeout(r, 50));
    expect(pendingCards).toHaveLength(1);

    // Complete A — now B should start
    pendingCards[0]!.resolve({ success: true, exitCode: 0, output: "done" });

    await new Promise<void>((resolve) => {
      const check = () => {
        if (pendingCards.length >= 2) resolve();
        else setTimeout(check, 10);
      };
      check();
    });

    expect(pendingCards[1]!.card.title).toBe("Card B");

    pendingCards[1]!.resolve({ success: true, exitCode: 0, output: "done" });
    await completed;
  });

  test("notifyNewCard is a no-op when queue is not running", () => {
    const { callbacks } = makeCallbacksWithCompletion();
    notifyNewCard(db, boardId, callbacks);
    expect(getQueueState(boardId).isRunning).toBe(false);
  });

  test("multiple cards added mid-run all get picked up as slots open", async () => {
    autoResolve = false;

    updateGlobalConfig(db, { maxConcurrentCards: 2 });

    createCard(db, boardId, { title: "Card A", description: "", tags: [], status: "queued" });
    createCard(db, boardId, { title: "Card B", description: "", tags: [], status: "queued" });

    const { callbacks, completed } = makeCallbacksWithCompletion();
    void startQueue(db, boardId, callbacks);

    // Wait for A and B to start
    await new Promise<void>((resolve) => {
      const check = () => {
        if (pendingCards.length >= 2) resolve();
        else setTimeout(check, 10);
      };
      check();
    });

    // Add 3 more cards while queue is running
    createCard(db, boardId, { title: "Card C", description: "", tags: [], status: "queued" });
    createCard(db, boardId, { title: "Card D", description: "", tags: [], status: "queued" });
    createCard(db, boardId, { title: "Card E", description: "", tags: [], status: "queued" });

    // Complete A — should pick up C
    pendingCards[0]!.resolve({ success: true, exitCode: 0, output: "done" });
    await new Promise<void>((resolve) => {
      const check = () => {
        if (pendingCards.length >= 3) resolve();
        else setTimeout(check, 10);
      };
      check();
    });
    expect(pendingCards[2]!.card.title).toBe("Card C");

    // Complete B — should pick up D
    pendingCards[1]!.resolve({ success: true, exitCode: 0, output: "done" });
    await new Promise<void>((resolve) => {
      const check = () => {
        if (pendingCards.length >= 4) resolve();
        else setTimeout(check, 10);
      };
      check();
    });
    expect(pendingCards[3]!.card.title).toBe("Card D");

    // Complete C — should pick up E
    pendingCards[2]!.resolve({ success: true, exitCode: 0, output: "done" });
    await new Promise<void>((resolve) => {
      const check = () => {
        if (pendingCards.length >= 5) resolve();
        else setTimeout(check, 10);
      };
      check();
    });
    expect(pendingCards[4]!.card.title).toBe("Card E");

    // Complete D and E
    pendingCards[3]!.resolve({ success: true, exitCode: 0, output: "done" });
    pendingCards[4]!.resolve({ success: true, exitCode: 0, output: "done" });
    await completed;
  });
});

describe("broadcast includes active array", () => {
  test("queue:updated events include the active card IDs", async () => {
    autoResolve = false;

    updateGlobalConfig(db, { maxConcurrentCards: 2 });

    const cardA = createCard(db, boardId, { title: "Card A", description: "", tags: [], status: "queued" });
    const cardB = createCard(db, boardId, { title: "Card B", description: "", tags: [], status: "queued" });

    const { callbacks, completed } = makeCallbacksWithCompletion();
    void startQueue(db, boardId, callbacks);

    await new Promise<void>((resolve) => {
      const check = () => {
        if (pendingCards.length >= 2) resolve();
        else setTimeout(check, 10);
      };
      check();
    });

    // Check that the initial broadcast included the active array
    const firstUpdate = events.find((e) => e.type === "queue:updated");
    expect(firstUpdate).toBeDefined();
    const payload = firstUpdate!.payload as { active?: string[] };
    expect(payload.active).toBeDefined();
    expect(payload.active).toContain(cardA.id);
    expect(payload.active).toContain(cardB.id);

    // Resolve all
    for (const p of pendingCards) {
      p.resolve({ success: true, exitCode: 0, output: "done" });
    }
    await completed;
  });
});

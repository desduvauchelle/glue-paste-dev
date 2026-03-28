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

const { startQueue, executeSingleCard } = await import(
  "../../executor/queue.js"
);

let db: Database;
let boardId: BoardId;
let events: Array<{ type: string; payload?: unknown }>;

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
      events.push({
        type: "queue:stopped",
        payload: { boardId: bid, reason },
      });
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

describe("queue skips human-assigned cards", () => {
  test("startQueue with only human cards stops immediately", async () => {
    createCard(db, boardId, {
      title: "Human Card 1",
      description: "",
      tags: [],
      status: "queued",
      assignee: "human",
    });
    createCard(db, boardId, {
      title: "Human Card 2",
      description: "",
      tags: [],
      status: "queued",
      assignee: "human",
    });

    const { callbacks, completed } = makeCallbacksWithCompletion();
    await startQueue(db, boardId, callbacks);
    await completed;

    const stopEvent = events.find((e) => e.type === "queue:stopped");
    expect(stopEvent).toBeDefined();
    expect(
      (stopEvent!.payload as { reason: string }).reason
    ).toBe("No queued cards to execute");

    // Human cards remain queued (not touched)
    expect(listCardsByStatus(db, boardId, "queued")).toHaveLength(2);
  });

  test("human cards are never passed to runCard in a mixed queue", async () => {
    createCard(db, boardId, {
      title: "Human First",
      description: "",
      tags: [],
      status: "queued",
      assignee: "human",
    });
    const aiCard = createCard(db, boardId, {
      title: "AI Card",
      description: "",
      tags: [],
      status: "queued",
      assignee: "ai",
    });
    createCard(db, boardId, {
      title: "Human Last",
      description: "",
      tags: [],
      status: "queued",
      assignee: "human",
    });

    const executedTitles: string[] = [];
    mockRunCardBehavior = async (card) => {
      executedTitles.push(card.title);
      return { success: true, exitCode: 0, output: "done" };
    };

    const { callbacks, completed } = makeCallbacksWithCompletion();
    await startQueue(db, boardId, callbacks);
    await completed;

    expect(executedTitles).toEqual(["AI Card"]);
    expect(getCard(db, aiCard.id as CardId)!.status).toBe("done");
  });

  test("human cards added mid-queue are skipped by fillSlots", async () => {
    const aiCard = createCard(db, boardId, {
      title: "AI Card",
      description: "",
      tags: [],
      status: "queued",
      assignee: "ai",
    });

    let addedMidExecution = false;
    mockRunCardBehavior = async (card) => {
      if (!addedMidExecution) {
        addedMidExecution = true;
        // Add a human card mid-queue — should be skipped
        createCard(db, boardId, {
          title: "Human Mid-Run",
          description: "",
          tags: [],
          status: "queued",
          assignee: "human",
        });
        // Add an AI card mid-queue — should be picked up
        createCard(db, boardId, {
          title: "AI Mid-Run",
          description: "",
          tags: [],
          status: "queued",
          assignee: "ai",
        });
      }
      return { success: true, exitCode: 0, output: "done" };
    };

    const executedTitles: string[] = [];
    const origBehavior = mockRunCardBehavior;
    mockRunCardBehavior = async (card) => {
      executedTitles.push(card.title);
      return origBehavior(card);
    };

    const { callbacks, completed } = makeCallbacksWithCompletion();
    await startQueue(db, boardId, callbacks);
    await completed;

    expect(executedTitles).toEqual(["AI Card", "AI Mid-Run"]);
    // Human card stays queued
    const queued = listCardsByStatus(db, boardId, "queued");
    expect(queued).toHaveLength(1);
    expect(queued[0]!.title).toBe("Human Mid-Run");
    expect(queued[0]!.assignee).toBe("human");
  });

  test("human card status is never changed by the queue", async () => {
    const humanCard = createCard(db, boardId, {
      title: "Human Card",
      description: "",
      tags: [],
      status: "queued",
      assignee: "human",
    });
    createCard(db, boardId, {
      title: "AI Card",
      description: "",
      tags: [],
      status: "queued",
      assignee: "ai",
    });

    const { callbacks, completed } = makeCallbacksWithCompletion();
    await startQueue(db, boardId, callbacks);
    await completed;

    // Human card status must remain unchanged
    const human = getCard(db, humanCard.id as CardId)!;
    expect(human.status).toBe("queued");
    expect(human.assignee).toBe("human");

    // No card:updated event for the human card
    const humanUpdates = events.filter(
      (e) =>
        e.type === "card:updated" &&
        (e.payload as { id: string }).id === humanCard.id
    );
    expect(humanUpdates).toHaveLength(0);
  });
});

describe("executeSingleCard rejects human-assigned cards", () => {
  test("throws for human-assigned card", async () => {
    const card = createCard(db, boardId, {
      title: "Human Card",
      description: "",
      tags: [],
      status: "queued",
      assignee: "human",
    });

    const { callbacks } = makeCallbacksWithCompletion();
    expect(
      executeSingleCard(db, card.id as CardId, callbacks)
    ).rejects.toThrow("human");
  });

  test("human card status is not changed after rejection", async () => {
    const card = createCard(db, boardId, {
      title: "Human Card",
      description: "",
      tags: [],
      status: "queued",
      assignee: "human",
    });

    const { callbacks } = makeCallbacksWithCompletion();
    try {
      await executeSingleCard(db, card.id as CardId, callbacks);
    } catch {
      // expected
    }

    // Status must remain queued
    expect(getCard(db, card.id as CardId)!.status).toBe("queued");
  });
});

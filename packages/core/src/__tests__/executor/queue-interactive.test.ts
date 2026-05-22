import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../db/schema.js";
import { createBoard } from "../../db/boards.js";
import { createCard, getCard } from "../../db/cards.js";
import type { BoardId, CardId, CardWithTags } from "../../types/index.js";
import type { QueueCallbacks } from "../../executor/queue.js";
import type { RunResult } from "../../executor/runner.js";
import { TerminalHub } from "../../terminal/index.js";

// --- Mock extract-report so no real claude is spawned during interactive runs ---
// Only mock the async AI-calling functions; preserve writeReportFile and parseReportJson
// to avoid poisoning the module cache for co-resident extract-report.test.ts.
const realExtractReport = await import("../../executor/extract-report.js");
mock.module("../../executor/extract-report.js", () => ({
  ...realExtractReport,
  extractPlanReport: async () => null,
  extractExecuteReport: async () => null,
}));

// --- Mock runCard (preserve real exports to avoid poisoning module cache for other test files) ---
const realRunner = await import("../../executor/runner.js");
let mockRunCardBehavior: (card: CardWithTags) => Promise<RunResult>;

mock.module("../../executor/runner.js", () => ({
  ...realRunner,
  runCard: async (_db: Database, card: CardWithTags, ..._rest: unknown[]) => {
    return mockRunCardBehavior(card);
  },
  killCardProcess: () => false,
  getActiveCardProcess: () => undefined,
}));

const {
  startQueue,
  executeSingleCard,
  setInteractiveHub,
  clearAwaitingReview,
} = await import("../../executor/queue.js");

// IDLE_SAMPLE: a string that triggers detectIdle() — input-box caret ❯ not followed by digit.
const IDLE_SAMPLE = '❯Try"createautillogging.pythat..."';

/**
 * Build a TerminalHub whose sessions immediately resolve:
 *   - outcome "idle"  → emits IDLE_SAMPLE after one tick → runCardInteractive returns success
 *   - outcome "exit"  → fires onExit(code) after one tick → runCardInteractive returns failure
 */
function makeAutoHub(outcome: "idle" | { exit: number }): TerminalHub {
  return new TerminalHub({
    permissionMode: "always-ask",
    createSession: (_cardId, onData, onExit) => {
      if (outcome === "idle") {
        setTimeout(() => onData(IDLE_SAMPLE), 10);
      } else {
        setTimeout(() => onExit(outcome.exit), 10);
      }
      return {
        write: () => {},
        resize: () => {},
        kill: () => {},
        getScrollback: () => "",
        isRunning: () => outcome === "idle",
      };
    },
    onOutput: () => {},
    onExit: () => {},
    initialInputDelayMs: 0,
  });
}

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

  mockRunCardBehavior = async () => ({ success: true, exitCode: 0, output: "done" });
});

afterEach(() => {
  // Reset hub between tests to avoid state leaking
  setInteractiveHub(null);
});

describe("interactive routing — queue path (processCard)", () => {
  test("with hub set and claude provider: interactive path used (card stays in-progress)", async () => {
    const hub = makeAutoHub("idle");
    setInteractiveHub(hub);

    const card = createCard(db, boardId, {
      title: "Claude Card",
      description: "",
      tags: [],
      status: "queued",
      cli_provider: "claude",
    });

    const { callbacks, completed } = makeCallbacksWithCompletion();
    await startQueue(db, boardId, callbacks);
    await completed;

    // Interactive path: pty-runner sets in-progress and leaves it there on success
    expect(getCard(db, card.id as CardId)!.status).toBe("in-progress");
  });

  test("with hub set but non-claude provider: headless path used (card goes to done)", async () => {
    const hub = makeAutoHub("idle");
    setInteractiveHub(hub);

    let runCardCalled = 0;
    mockRunCardBehavior = async () => {
      runCardCalled++;
      return { success: true, exitCode: 0, output: "done" };
    };

    const card = createCard(db, boardId, {
      title: "Gemini Card",
      description: "",
      tags: [],
      status: "queued",
      cli_provider: "gemini",
    });

    const { callbacks, completed } = makeCallbacksWithCompletion();
    await startQueue(db, boardId, callbacks);
    await completed;

    // Headless path: runCard called, queue sets card to done
    expect(runCardCalled).toBeGreaterThan(0);
    expect(getCard(db, card.id as CardId)!.status).toBe("done");
  });

  test("with claude provider but NO hub: falls back to headless (card goes to done)", async () => {
    setInteractiveHub(null);

    let runCardCalled = 0;
    mockRunCardBehavior = async () => {
      runCardCalled++;
      return { success: true, exitCode: 0, output: "done" };
    };

    const card = createCard(db, boardId, {
      title: "Claude No Hub",
      description: "",
      tags: [],
      status: "queued",
      cli_provider: "claude",
    });

    const { callbacks, completed } = makeCallbacksWithCompletion();
    await startQueue(db, boardId, callbacks);
    await completed;

    expect(runCardCalled).toBeGreaterThan(0);
    expect(getCard(db, card.id as CardId)!.status).toBe("done");
  });

  test("after interactive success: card stays in-progress (NOT done)", async () => {
    const hub = makeAutoHub("idle");
    setInteractiveHub(hub);

    const card = createCard(db, boardId, {
      title: "Interactive Success",
      description: "",
      tags: [],
      status: "queued",
      cli_provider: "claude",
    });

    const { callbacks, completed } = makeCallbacksWithCompletion();
    await startQueue(db, boardId, callbacks);
    await completed;

    // Card should remain in-progress (pty-runner set it; queue must NOT move it to done)
    expect(getCard(db, card.id as CardId)!.status).toBe("in-progress");
  });

  test("after interactive success: fillSlots does NOT re-queue the same card (awaiting-review guard)", async () => {
    const hub = makeAutoHub("idle");
    setInteractiveHub(hub);

    // One claude card (idles after running) + one gemini card (completes normally)
    // After the claude card idles and its slot is freed, fillSlots picks up the gemini card.
    // When the gemini card completes the queue ends — at no point should the claude card be re-picked.
    const card = createCard(db, boardId, {
      title: "Idled Card",
      description: "",
      tags: [],
      status: "queued",
      cli_provider: "claude",
    });
    const geminiCard = createCard(db, boardId, {
      title: "Normal Card",
      description: "",
      tags: [],
      status: "queued",
      cli_provider: "gemini",
    });

    const { callbacks, completed } = makeCallbacksWithCompletion();
    await startQueue(db, boardId, callbacks);
    await completed;

    // The idled claude card must still be in-progress (not re-picked or reset)
    expect(getCard(db, card.id as CardId)!.status).toBe("in-progress");
    // The gemini card should have completed normally
    expect(getCard(db, geminiCard.id as CardId)!.status).toBe("done");
  });

  test("after interactive failure: card marked failed", async () => {
    const hub = makeAutoHub({ exit: 1 });
    setInteractiveHub(hub);

    const card = createCard(db, boardId, {
      title: "Failing Interactive",
      description: "",
      tags: [],
      status: "queued",
      cli_provider: "claude",
    });

    const { callbacks, completed } = makeCallbacksWithCompletion();
    await startQueue(db, boardId, callbacks);
    await completed;

    expect(getCard(db, card.id as CardId)!.status).toBe("failed");
  });
});

describe("interactive routing — executeSingleCard path", () => {
  test("with hub set and claude provider: interactive path used (card stays in-progress)", async () => {
    const hub = makeAutoHub("idle");
    setInteractiveHub(hub);

    const card = createCard(db, boardId, {
      title: "Single Interactive",
      description: "",
      tags: [],
      status: "queued",
      cli_provider: "claude",
    });

    const { callbacks } = makeCallbacksWithCompletion();
    await executeSingleCard(db, card.id as CardId, callbacks);

    // Interactive path: pty-runner sets in-progress and leaves it there on success
    expect(getCard(db, card.id as CardId)!.status).toBe("in-progress");
  });

  test("with claude provider but NO hub: executeSingleCard falls back to runCard (card goes to done)", async () => {
    setInteractiveHub(null);

    let runCardCalled = 0;
    mockRunCardBehavior = async () => {
      runCardCalled++;
      return { success: true, exitCode: 0, output: "done" };
    };

    const card = createCard(db, boardId, {
      title: "Single No Hub",
      description: "",
      tags: [],
      status: "queued",
      cli_provider: "claude",
    });

    const { callbacks } = makeCallbacksWithCompletion();
    await executeSingleCard(db, card.id as CardId, callbacks);

    expect(runCardCalled).toBeGreaterThan(0);
    expect(getCard(db, card.id as CardId)!.status).toBe("done");
  });

  test("executeSingleCard interactive success: card stays in-progress", async () => {
    const hub = makeAutoHub("idle");
    setInteractiveHub(hub);

    const card = createCard(db, boardId, {
      title: "Single Interactive Success",
      description: "",
      tags: [],
      status: "queued",
      cli_provider: "claude",
    });

    const { callbacks } = makeCallbacksWithCompletion();
    await executeSingleCard(db, card.id as CardId, callbacks);

    // Card should remain in-progress (pty-runner set it; queue must NOT move it to done)
    expect(getCard(db, card.id as CardId)!.status).toBe("in-progress");
  });

  test("executeSingleCard interactive failure: card marked failed", async () => {
    const hub = makeAutoHub({ exit: 1 });
    setInteractiveHub(hub);

    const card = createCard(db, boardId, {
      title: "Single Interactive Fail",
      description: "",
      tags: [],
      status: "queued",
      cli_provider: "claude",
    });

    const { callbacks } = makeCallbacksWithCompletion();
    await executeSingleCard(db, card.id as CardId, callbacks);

    expect(getCard(db, card.id as CardId)!.status).toBe("failed");
  });
});

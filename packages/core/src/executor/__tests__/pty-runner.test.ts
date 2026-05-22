import { describe, test, expect, beforeEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../db/schema.js";
import { createBoard } from "../../db/boards.js";
import { createCard, getCard } from "../../db/cards.js";
import { listComments } from "../../db/comments.js";
import { listExecutions } from "../../db/executions.js";
import type { BoardId, CardId, CardWithTags, Comment, ConfigInput } from "../../types/index.js";
import type { RunnerCallbacks } from "../runner.js";
import { TerminalHub, type SessionLike } from "../../terminal/index.js";

// --- Mock extract-report so no real claude is spawned ---
mock.module("../extract-report.js", () => ({
  extractPlanReport: async () => null,
  extractExecuteReport: async () => null,
  writeReportFile: () => {},
}));

// Note: captureGitSha and captureFileChanges are imported from runner.js.
// In test environment git commands may return null/[] for /tmp dirs — that is fine.

const { runCardInteractive } = await import("../pty-runner.js");

// ── FakeSession setup ──────────────────────────────────────────────────────

type FakeSession = SessionLike & {
  emit: (s: string) => void;
  fireExit: (c: number) => void;
  _onData: (s: string) => void;
  writes: string[];
};

function makeFakeSession() {
  const writes: string[] = [];
  let last = "";
  let onExit: ((c: number) => void) | undefined;
  const fake: FakeSession = {
    write: (d: string) => writes.push(d),
    resize: () => {},
    kill: () => {},
    getScrollback: () => last,
    isRunning: () => true,
    _onData: () => {},
    emit(this: FakeSession, s: string) {
      last = s;
      this._onData(s);
    },
    fireExit(c: number) {
      onExit?.(c);
    },
    get writes() {
      return writes;
    },
  } as never;
  return { fake, setOnExit: (f: (c: number) => void) => (onExit = f) };
}

const IDLE_SAMPLE = '❯Try"createautillogging.pythat..."';

// ── DB + board/card helpers ────────────────────────────────────────────────

const FAKE_CONFIG: Required<ConfigInput> = {
  cliProvider: "claude",
  cliCustomCommand: "",
  model: "claude-opus-4-6",
  planModel: "",
  executeModel: "",
  maxBudgetUsd: 10.0,
  autoCommit: false,
  autoPush: false,
  planThinking: "smart",
  executeThinking: "smart",
  customTags: [],
  customInstructions: "",
  branchMode: "current",
  branchName: "",
  maxConcurrentCards: 1,
  terminalPermissionMode: "always-ask",
};

function makeCallbacks() {
  const events: Array<{ type: string; payload?: unknown }> = [];
  const callbacks: RunnerCallbacks = {
    onExecutionStarted: (cardId, executionId, phase) =>
      events.push({ type: "executionStarted", payload: { cardId, executionId, phase } }),
    onOutput: (executionId, chunk) =>
      events.push({ type: "output", payload: { executionId, chunk } }),
    onExecutionCompleted: (executionId, status, exitCode) =>
      events.push({ type: "executionCompleted", payload: { executionId, status, exitCode } }),
    onCardUpdated: (card) =>
      events.push({ type: "cardUpdated", payload: { id: card.id, status: card.status } }),
    onCommentAdded: (comment) =>
      events.push({ type: "commentAdded", payload: { content: comment.content } }),
  };
  return { callbacks, events };
}

let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  initSchema(db);
});

describe("runCardInteractive", () => {
  test("success path: idle emission → success, session stays alive, extractExecuteReport called", async () => {
    // Reset mock to track calls
    let extractExecuteReportCalled = false;
    mock.module("../extract-report.js", () => ({
      extractPlanReport: async () => null,
      extractExecuteReport: async () => {
        extractExecuteReportCalled = true;
        return null; // return null to keep it simple
      },
      writeReportFile: () => {},
    }));

    const board = createBoard(db, { name: "Test Board", description: "", directory: "/tmp/test-pty" });
    const card = createCard(db, board.id as BoardId, {
      title: "Test Card",
      description: "Do something",
      tags: [],
      status: "queued",
    });
    const comments: Comment[] = [];

    const { fake, setOnExit } = makeFakeSession();
    const hub = new TerminalHub({
      permissionMode: "always-ask",
      createSession: (_c, onData, onExit) => {
        fake._onData = onData;
        setOnExit(onExit);
        return fake;
      },
      onOutput: () => {},
      onExit: () => {},
      initialInputDelayMs: 0,
    });

    const { callbacks, events } = makeCallbacks();

    // Start the run but don't await yet — emit idle after
    const runPromise = runCardInteractive(db, card as CardWithTags, board, comments, FAKE_CONFIG, hub, callbacks);

    // Wait for the initialInput gate to open (initialInputDelayMs = 0, but still needs a tick)
    await Bun.sleep(10);

    // Emit idle to complete the turn
    fake.emit(IDLE_SAMPLE);

    const result = await runPromise;

    // (1) Resolved to success
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);

    // (2) Card was set to in-progress at some point
    const cardStatusEvents = events.filter(
      (e) => e.type === "cardUpdated" && (e.payload as { status: string }).status === "in-progress"
    );
    expect(cardStatusEvents.length).toBeGreaterThan(0);

    // (3) Execution was created and transcript appended
    const executions = listExecutions(db, card.id as CardId);
    expect(executions.length).toBe(1);
    expect(executions[0]!.status).toBe("success");

    // (4) Session stays alive (FakeSession.isRunning() always returns true)
    expect(hub.isRunning(card.id)).toBe(true);

    // (5) extractExecuteReport was called
    expect(extractExecuteReportCalled).toBe(true);

    // (6) Comments were added
    const comments2 = listComments(db, card.id as CardId);
    expect(comments2.some((c) => c.content === "Execution started.")).toBe(true);
    expect(comments2.some((c) => c.content === "Turn complete — awaiting review.")).toBe(true);

    // (7) onExecutionCompleted fired with success
    const completedEvent = events.find(
      (e) => e.type === "executionCompleted" && (e.payload as { status: string }).status === "success"
    );
    expect(completedEvent).toBeDefined();
  });

  test("failure path: session exit before idle → failed result, execution marked failed", async () => {
    const board = createBoard(db, { name: "Test Board 2", description: "", directory: "/tmp/test-pty-2" });
    const card = createCard(db, board.id as BoardId, {
      title: "Failing Card",
      description: "Do something",
      tags: [],
      status: "queued",
    });
    const comments: Comment[] = [];

    const { fake, setOnExit } = makeFakeSession();
    const hub = new TerminalHub({
      permissionMode: "always-ask",
      createSession: (_c, onData, onExit) => {
        fake._onData = onData;
        setOnExit(onExit);
        return fake;
      },
      onOutput: () => {},
      onExit: () => {},
      initialInputDelayMs: 0,
    });

    const { callbacks, events } = makeCallbacks();

    const runPromise = runCardInteractive(db, card as CardWithTags, board, comments, FAKE_CONFIG, hub, callbacks);

    // Wait a tick, then fire exit instead of idle
    await Bun.sleep(10);
    fake.fireExit(42);

    const result = await runPromise;

    // (1) Resolved to failure with correct exit code
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(42);

    // (2) Execution is marked failed
    const executions = listExecutions(db, card.id as CardId);
    expect(executions.length).toBe(1);
    expect(executions[0]!.status).toBe("failed");
    expect(executions[0]!.exit_code).toBe(42);

    // (3) Failure comment was added
    const dbComments = listComments(db, card.id as CardId);
    expect(
      dbComments.some((c) => c.content.includes("Session exited (code 42)"))
    ).toBe(true);

    // (4) onExecutionCompleted fired with failed
    const completedEvent = events.find(
      (e) => e.type === "executionCompleted" && (e.payload as { status: string }).status === "failed"
    );
    expect(completedEvent).toBeDefined();
    expect((completedEvent!.payload as { exitCode: number }).exitCode).toBe(42);
  });
});

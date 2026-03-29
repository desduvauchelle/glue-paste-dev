import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../db/schema.js";
import { createBoard } from "../../db/boards.js";
import { createCard } from "../../db/cards.js";
import {
  listExecutions,
  getExecution,
  createExecution,
  updateExecutionStatus,
  updateExecutionPid,
  appendExecutionOutput,
  updateExecutionCost,
  getCompletedPlanOutput,
  updateExecutionFilesChanged,
  getRunningExecutionPids,
  getLastSessionId,
  cancelRunningExecutions,
} from "../../db/executions.js";
import type { BoardId, CardId, ExecutionId } from "../../types/index.js";

let db: Database;
let boardId: BoardId;
let cardId: CardId;

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

  const card = createCard(db, boardId, {
    title: "Test Card",
    description: "",
    tags: [],
  });
  cardId = card.id as CardId;
});

describe("executions", () => {
  it("should create an execution record", () => {
    const exec = createExecution(db, cardId, "session-1", "plan");
    expect(exec.card_id).toBe(cardId);
    expect(exec.session_id).toBe("session-1");
    expect(exec.phase).toBe("plan");
    expect(exec.status).toBe("running");
  });

  it("should list executions for a card in desc order", () => {
    const exec1 = createExecution(db, cardId, "s1", "plan");
    // Manually set started_at to ensure ordering
    db.query("UPDATE executions SET started_at = datetime('now', '-1 minute') WHERE id = ?").run(exec1.id);
    createExecution(db, cardId, "s2", "execute");

    const list = listExecutions(db, cardId);
    expect(list).toHaveLength(2);
    // Most recent first
    expect(list[0]!.phase).toBe("execute");
    expect(list[1]!.phase).toBe("plan");
  });

  it("should get a single execution by id", () => {
    const exec = createExecution(db, cardId, "s1", "plan");
    const fetched = getExecution(db, exec.id as ExecutionId);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(exec.id);
  });

  it("should return null for non-existent execution", () => {
    const fetched = getExecution(db, "nonexistent" as ExecutionId);
    expect(fetched).toBeNull();
  });

  it("should update execution status and set finished_at", () => {
    const exec = createExecution(db, cardId, "s1", "plan");
    updateExecutionStatus(db, exec.id as ExecutionId, "success", 0);

    const updated = getExecution(db, exec.id as ExecutionId);
    expect(updated!.status).toBe("success");
    expect(updated!.exit_code).toBe(0);
    expect(updated!.finished_at).not.toBeNull();
  });

  it("should update execution PID", () => {
    const exec = createExecution(db, cardId, "s1", "execute");
    updateExecutionPid(db, exec.id as ExecutionId, 12345);

    const updated = getExecution(db, exec.id as ExecutionId);
    expect(updated!.pid).toBe(12345);
  });

  it("should append output chunks", () => {
    const exec = createExecution(db, cardId, "s1", "plan");
    appendExecutionOutput(db, exec.id as ExecutionId, "Hello ");
    appendExecutionOutput(db, exec.id as ExecutionId, "World");

    const updated = getExecution(db, exec.id as ExecutionId);
    expect(updated!.output).toBe("Hello World");
  });

  it("should update execution cost", () => {
    const exec = createExecution(db, cardId, "s1", "plan");
    updateExecutionCost(db, exec.id as ExecutionId, 0.42);

    const updated = getExecution(db, exec.id as ExecutionId);
    expect(updated!.cost_usd).toBe(0.42);
  });

  it("should get completed plan output", () => {
    // No plan yet
    expect(getCompletedPlanOutput(db, cardId)).toBeNull();

    // Failed plan should not count
    const failedPlan = createExecution(db, cardId, "s1", "plan");
    updateExecutionStatus(db, failedPlan.id as ExecutionId, "failed", 1);

    expect(getCompletedPlanOutput(db, cardId)).toBeNull();

    // Successful plan
    const successPlan = createExecution(db, cardId, "s2", "plan");
    appendExecutionOutput(db, successPlan.id as ExecutionId, "The plan output");
    updateExecutionStatus(db, successPlan.id as ExecutionId, "success", 0);

    expect(getCompletedPlanOutput(db, cardId)).toBe("The plan output");
  });

  it("should update files changed as JSON", () => {
    const exec = createExecution(db, cardId, "s1", "execute");
    const files = [
      { path: "src/index.ts", additions: 5, deletions: 2 },
      { path: "src/utils.ts", additions: 10, deletions: 0 },
    ];
    updateExecutionFilesChanged(db, exec.id as ExecutionId, files);

    const updated = getExecution(db, exec.id as ExecutionId);
    expect(JSON.parse(updated!.files_changed as string)).toEqual(files);
  });

  it("should get running execution PIDs", () => {
    const exec1 = createExecution(db, cardId, "s1", "execute");
    updateExecutionPid(db, exec1.id as ExecutionId, 1111);

    const card2 = createCard(db, boardId, { title: "Card 2", description: "", tags: [] });
    const exec2 = createExecution(db, card2.id as CardId, "s2", "plan");
    updateExecutionPid(db, exec2.id as ExecutionId, 2222);

    // Finish one
    updateExecutionStatus(db, exec1.id as ExecutionId, "success", 0);

    const pids = getRunningExecutionPids(db);
    expect(pids).toEqual([2222]);
  });

  it("should get last session ID for a card", () => {
    expect(getLastSessionId(db, cardId)).toBeNull();

    const exec1 = createExecution(db, cardId, "session-old", "plan");
    // Manually set started_at to ensure ordering
    db.query("UPDATE executions SET started_at = datetime('now', '-1 minute') WHERE id = ?").run(exec1.id);
    createExecution(db, cardId, "session-new", "execute");

    expect(getLastSessionId(db, cardId)).toBe("session-new");
  });

  it("should cancel all running executions", () => {
    const exec1 = createExecution(db, cardId, "s1", "plan");
    const card2 = createCard(db, boardId, { title: "Card 2", description: "", tags: [] });
    const exec2 = createExecution(db, card2.id as CardId, "s2", "execute");

    // Finish one first
    updateExecutionStatus(db, exec1.id as ExecutionId, "success", 0);

    const cancelled = cancelRunningExecutions(db);
    expect(cancelled).toBe(1); // only exec2 was still running

    const updated = getExecution(db, exec2.id as ExecutionId);
    expect(updated!.status).toBe("cancelled");
    expect(updated!.finished_at).not.toBeNull();
  });
});

describe("appendExecutionOutput trimming", () => {
  it("trims output to tail when exceeding 512KB", () => {
    const exec = createExecution(db, cardId, "s1", "plan");
    const execId = exec.id as ExecutionId;
    const bigChunk = "x".repeat(512 * 1024);
    appendExecutionOutput(db, execId, bigChunk);
    appendExecutionOutput(db, execId, "NEW_TAIL");
    const updated = getExecution(db, execId);
    expect(updated!.output).toContain("NEW_TAIL");
    expect(updated!.output!.length).toBeLessThanOrEqual(512 * 1024 + 100);
  });

  it("keeps appending normally under 512KB", () => {
    const exec = createExecution(db, cardId, "s1", "plan");
    const execId = exec.id as ExecutionId;
    appendExecutionOutput(db, execId, "chunk1-");
    appendExecutionOutput(db, execId, "chunk2-");
    appendExecutionOutput(db, execId, "chunk3");
    const updated = getExecution(db, execId);
    expect(updated!.output).toBe("chunk1-chunk2-chunk3");
  });
});

import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../db/schema.js";
import { createBoard } from "../../db/boards.js";
import { createCard, updateCardStatus, getCard } from "../../db/cards.js";
import { applyCardOverrides, getQueueState, pauseQueue, stopQueue } from "../../executor/queue.js";
import type { BoardId, CardId, CardWithTags, ConfigInput } from "../../types/index.js";
import type { QueueCallbacks } from "../../executor/queue.js";

// Helper to create a mock config
const makeConfig = (overrides?: Partial<Required<ConfigInput>>): Required<ConfigInput> => ({
  cliProvider: "claude",
  cliCustomCommand: "",
  model: "claude-opus-4-6",
  planModel: "",
  executeModel: "",
  maxBudgetUsd: 10,
  autoCommit: false,
  autoPush: false,
  planThinking: "smart",
  executeThinking: "smart",
  customTags: [],
  customInstructions: "",
  branchMode: "current",
  branchName: "",
  ...overrides,
});

const makeCard = (overrides?: Partial<CardWithTags>): CardWithTags => ({
  id: "card-1" as CardId,
  board_id: "board-1" as BoardId,
  title: "Test Card",
  description: "",
  status: "queued",
  position: 0,
  blocking: true,
  plan_thinking: null,
  execute_thinking: null,
  auto_commit: null,
  auto_push: null,
  cli_provider: null,
  cli_custom_command: null,
  branch_mode: null,
  branch_name: null,
  assignee: "ai",
  tags: [],
  files: [],
  created_at: "2024-01-01",
  updated_at: "2024-01-01",
  ...overrides,
});

const noopCallbacks: QueueCallbacks = {
  onQueueUpdated: () => {},
  onQueueStopped: () => {},
  onExecutionStarted: () => {},
  onOutput: () => {},
  onExecutionCompleted: () => {},
  onCardUpdated: () => {},
  onCommentAdded: () => {},
};

describe("applyCardOverrides", () => {
  test("uses config values when card overrides are null", () => {
    const config = makeConfig({ planThinking: "smart", executeThinking: "basic", autoCommit: true, autoPush: true });
    const card = makeCard({ plan_thinking: null, execute_thinking: null, auto_commit: null, auto_push: null });

    const result = applyCardOverrides(config, card);
    expect(result.planThinking).toBe("smart");
    expect(result.executeThinking).toBe("basic");
    expect(result.autoCommit).toBe(true);
    expect(result.autoPush).toBe(true);
  });

  test("card plan_thinking overrides config", () => {
    const config = makeConfig({ planThinking: "smart" });
    const card = makeCard({ plan_thinking: "basic" });

    const result = applyCardOverrides(config, card);
    expect(result.planThinking).toBe("basic");
  });

  test("card plan_thinking 'none' sets planThinking to null", () => {
    const config = makeConfig({ planThinking: "smart" });
    const card = makeCard({ plan_thinking: "none" });

    const result = applyCardOverrides(config, card);
    expect(result.planThinking).toBeNull();
  });

  test("card execute_thinking overrides config", () => {
    const config = makeConfig({ executeThinking: "smart" });
    const card = makeCard({ execute_thinking: "basic" });

    const result = applyCardOverrides(config, card);
    expect(result.executeThinking).toBe("basic");
  });

  test("card auto_commit overrides config", () => {
    const config = makeConfig({ autoCommit: false });
    const card = makeCard({ auto_commit: true });

    const result = applyCardOverrides(config, card);
    expect(result.autoCommit).toBe(true);
  });

  test("card auto_push overrides config", () => {
    const config = makeConfig({ autoPush: false });
    const card = makeCard({ auto_push: true });

    const result = applyCardOverrides(config, card);
    expect(result.autoPush).toBe(true);
  });

  test("preserves other config fields", () => {
    const config = makeConfig({ model: "my-model", maxBudgetUsd: 50, customInstructions: "Be careful" });
    const card = makeCard();

    const result = applyCardOverrides(config, card);
    expect(result.model).toBe("my-model");
    expect(result.maxBudgetUsd).toBe(50);
    expect(result.customInstructions).toBe("Be careful");
  });
});

describe("getQueueState", () => {
  test("returns default state for unknown board", () => {
    const state = getQueueState("unknown-board");
    expect(state.boardId).toBe("unknown-board");
    expect(state.queue).toEqual([]);
    expect(state.current).toBeNull();
    expect(state.isRunning).toBe(false);
    expect(state.isPaused).toBe(false);
  });
});

describe("pauseQueue", () => {
  test("does nothing for non-existent queue", () => {
    const updates: string[] = [];
    const callbacks = {
      ...noopCallbacks,
      onQueueUpdated: () => updates.push("updated"),
    };
    pauseQueue("nonexistent-board", callbacks);
    expect(updates).toHaveLength(0);
  });
});

describe("stopQueue", () => {
  test("does nothing for non-existent queue", () => {
    const stops: string[] = [];
    const callbacks = {
      ...noopCallbacks,
      onQueueStopped: () => stops.push("stopped"),
    };
    stopQueue("nonexistent-board", callbacks);
    expect(stops).toHaveLength(0);
  });
});

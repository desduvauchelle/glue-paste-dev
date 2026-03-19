import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../db/schema.js";
import { createBoard } from "../../db/boards.js";
import {
  getGlobalConfig,
  getProjectConfig,
  getMergedConfig,
  updateGlobalConfig,
  updateProjectConfig,
} from "../../config/manager.js";
import type { BoardId } from "../../types/index.js";

let db: Database;
let boardId: BoardId;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  initSchema(db);

  const board = createBoard(db, {
    name: "Test",
    description: "",
    directory: "/tmp/test",
  });
  boardId = board.id as BoardId;
});

describe("config manager", () => {
  it("should return default global config", () => {
    const config = getGlobalConfig(db);
    expect(config.cliProvider).toBe("claude");
    expect(config.cliCustomCommand).toBe("");
    expect(config.model).toBe("claude-opus-4-6");
    expect(config.maxBudgetUsd).toBe(10.0);
    expect(config.autoConfirm).toBe(true);
    expect(config.planThinking).toBe("smart");
    expect(config.customTags).toEqual([]);
  });

  it("should update global config", () => {
    updateGlobalConfig(db, { model: "claude-sonnet-4-6", customTags: ["API"] });
    const config = getGlobalConfig(db);
    expect(config.model).toBe("claude-sonnet-4-6");
    expect(config.customTags).toEqual(["API"]);
    // Other fields remain default
    expect(config.maxBudgetUsd).toBe(10.0);
  });

  it("should return null for non-existent project config", () => {
    const config = getProjectConfig(db, boardId);
    expect(config).toBeNull();
  });

  it("should create and retrieve project config", () => {
    updateProjectConfig(db, boardId, { model: "claude-haiku-4-5-20251001" });
    const config = getProjectConfig(db, boardId);
    expect(config?.model).toBe("claude-haiku-4-5-20251001");
  });

  it("should merge project config over global", () => {
    updateGlobalConfig(db, {
      model: "claude-opus-4-6",
      maxBudgetUsd: 10.0,
      customTags: ["UX", "backend"],
    });
    updateProjectConfig(db, boardId, {
      model: "claude-sonnet-4-6",
      maxBudgetUsd: 5.0,
      customTags: ["API"],
    });

    const merged = getMergedConfig(db, boardId);
    expect(merged.model).toBe("claude-sonnet-4-6"); // project override
    expect(merged.maxBudgetUsd).toBe(5.0); // project override
    expect(merged.customTags).toEqual(["API"]); // project override
  });

  it("should return global when no project config exists", () => {
    updateGlobalConfig(db, { model: "claude-opus-4-6" });
    const merged = getMergedConfig(db, boardId);
    expect(merged.model).toBe("claude-opus-4-6");
  });

  it("should update and retrieve CLI provider", () => {
    updateGlobalConfig(db, { cliProvider: "gemini", model: "gemini-pro" });
    const config = getGlobalConfig(db);
    expect(config.cliProvider).toBe("gemini");
    expect(config.model).toBe("gemini-pro");
  });

  it("should support custom CLI command", () => {
    updateGlobalConfig(db, { cliProvider: "custom", cliCustomCommand: "my-cli --flag" });
    const config = getGlobalConfig(db);
    expect(config.cliProvider).toBe("custom");
    expect(config.cliCustomCommand).toBe("my-cli --flag");
  });

  it("should merge CLI provider from project over global", () => {
    updateGlobalConfig(db, { cliProvider: "claude" });
    updateProjectConfig(db, boardId, { cliProvider: "gemini" });
    const merged = getMergedConfig(db, boardId);
    expect(merged.cliProvider).toBe("gemini");
  });

  it("should default autoCommit to false in DEFAULT_CONFIG", () => {
    // Note: DB migration still creates global row with auto_commit=1 for backwards compat.
    // New configs created via upsertConfig use DEFAULT_CONFIG which defaults to false.
    const { DEFAULT_CONFIG } = require("../../schemas/config.js");
    expect(DEFAULT_CONFIG.autoCommit).toBe(false);
  });

  it("should default autoPush to false", () => {
    const config = getGlobalConfig(db);
    expect(config.autoPush).toBe(false);
  });

  it("should persist and merge autoPush at global and project levels", () => {
    updateGlobalConfig(db, { autoPush: true });
    expect(getGlobalConfig(db).autoPush).toBe(true);

    updateProjectConfig(db, boardId, { autoPush: false });
    const merged = getMergedConfig(db, boardId);
    expect(merged.autoPush).toBe(false);
  });
});

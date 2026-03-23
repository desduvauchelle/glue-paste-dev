import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../db/schema.js";
import { createBoard } from "../../db/boards.js";
import { updateGlobalConfig, updateProjectConfig, getMergedConfig } from "../../config/manager.js";
import { applyCardOverrides } from "../../executor/queue.js";
import type { BoardId, CardId } from "../../types/index.js";
import type { CardWithTags } from "../../types/index.js";

let db: Database;
let boardId: BoardId;

function makeCard(overrides: Partial<CardWithTags> = {}): CardWithTags {
  return {
    id: "card-1" as CardId,
    board_id: boardId,
    title: "Test",
    description: "",
    status: "todo",
    position: 0,
    blocking: false,
    plan_thinking: null,
    execute_thinking: null,
    auto_commit: null,
    auto_push: null,
    cli_provider: null,
    cli_custom_command: null,
    branch_mode: null,
    branch_name: null,
    assignee: "ai",
    files: [],
    tags: [],
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

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

describe("applyCardOverrides — full config inheritance chain", () => {
  it("new card (all null) inherits global config", () => {
    updateGlobalConfig(db, {
      autoCommit: true,
      autoPush: true,
      planThinking: "basic",
      executeThinking: "basic",
    });

    const merged = getMergedConfig(db, boardId);
    const effective = applyCardOverrides(merged, makeCard());

    expect(effective.autoCommit).toBe(true);
    expect(effective.autoPush).toBe(true);
    expect(effective.planThinking).toBe("basic");
    expect(effective.executeThinking).toBe("basic");
  });

  it("new card inherits project override over global", () => {
    updateGlobalConfig(db, { autoCommit: false, planThinking: "smart" });
    updateProjectConfig(db, boardId, { autoCommit: true });

    const merged = getMergedConfig(db, boardId);
    const effective = applyCardOverrides(merged, makeCard());

    expect(effective.autoCommit).toBe(true);      // from project
    expect(effective.planThinking).toBe("smart"); // from global
  });

  it("card explicit override wins over merged config", () => {
    updateGlobalConfig(db, { autoCommit: false, autoPush: false });

    const merged = getMergedConfig(db, boardId);
    const effective = applyCardOverrides(merged, makeCard({ auto_commit: true, auto_push: true }));

    expect(effective.autoCommit).toBe(true);
    expect(effective.autoPush).toBe(true);
  });

  it("partial card override: only overridden fields change", () => {
    updateGlobalConfig(db, {
      autoCommit: false,
      autoPush: false,
      planThinking: "smart",
      executeThinking: "basic",
    });
    updateProjectConfig(db, boardId, { autoPush: true });

    const merged = getMergedConfig(db, boardId);
    const effective = applyCardOverrides(merged, makeCard({ plan_thinking: "basic" }));

    expect(effective.autoCommit).toBe(false);     // from global
    expect(effective.autoPush).toBe(true);         // from project
    expect(effective.planThinking).toBe("basic");  // from card
    expect(effective.executeThinking).toBe("basic"); // from global
  });

  it("project autoPush:false beats global autoPush:true (falsy value not skipped)", () => {
    updateGlobalConfig(db, { autoPush: true });
    updateProjectConfig(db, boardId, { autoPush: false });

    const merged = getMergedConfig(db, boardId);
    const effective = applyCardOverrides(merged, makeCard());

    expect(effective.autoPush).toBe(false);
  });

  it("project autoCommit:false beats global autoCommit:true (falsy value not skipped)", () => {
    updateGlobalConfig(db, { autoCommit: true });
    updateProjectConfig(db, boardId, { autoCommit: false });

    const merged = getMergedConfig(db, boardId);
    const effective = applyCardOverrides(merged, makeCard());

    expect(effective.autoCommit).toBe(false);
  });

  it("changing global cascades to merged when no project override", () => {
    updateProjectConfig(db, boardId, { planThinking: "smart" });

    updateGlobalConfig(db, { autoCommit: false });
    expect(applyCardOverrides(getMergedConfig(db, boardId), makeCard()).autoCommit).toBe(false);

    updateGlobalConfig(db, { autoCommit: true });
    expect(applyCardOverrides(getMergedConfig(db, boardId), makeCard()).autoCommit).toBe(true);

    // project planThinking still holds
    expect(applyCardOverrides(getMergedConfig(db, boardId), makeCard()).planThinking).toBe("smart");
  });

  it("card auto_commit:false beats merged autoCommit:true (falsy card value not skipped)", () => {
    updateGlobalConfig(db, { autoCommit: true });

    const merged = getMergedConfig(db, boardId);
    const effective = applyCardOverrides(merged, makeCard({ auto_commit: false }));

    expect(effective.autoCommit).toBe(false);
  });

  it("card auto_push:false beats merged autoPush:true (falsy card value not skipped)", () => {
    updateGlobalConfig(db, { autoPush: true });

    const merged = getMergedConfig(db, boardId);
    const effective = applyCardOverrides(merged, makeCard({ auto_push: false }));

    expect(effective.autoPush).toBe(false);
  });

  it("card plan_thinking:'none' overrides config to skip plan (null)", () => {
    updateGlobalConfig(db, { planThinking: "smart" });

    const merged = getMergedConfig(db, boardId);
    const effective = applyCardOverrides(merged, makeCard({ plan_thinking: "none" }));

    expect(effective.planThinking).toBeNull();
  });

  it("card cli_provider overrides merged config provider", () => {
    updateGlobalConfig(db, { cliProvider: "claude" });

    const merged = getMergedConfig(db, boardId);
    const effective = applyCardOverrides(merged, makeCard({ cli_provider: "gemini" }));

    expect(effective.cliProvider).toBe("gemini");
  });

  it("card cli_provider null inherits from merged config", () => {
    updateGlobalConfig(db, { cliProvider: "aider" });

    const merged = getMergedConfig(db, boardId);
    const effective = applyCardOverrides(merged, makeCard({ cli_provider: null }));

    expect(effective.cliProvider).toBe("aider");
  });

  it("card cli_custom_command overrides merged config", () => {
    updateGlobalConfig(db, { cliCustomCommand: "global-cmd" });

    const merged = getMergedConfig(db, boardId);
    const effective = applyCardOverrides(merged, makeCard({ cli_custom_command: "card-cmd" }));

    expect(effective.cliCustomCommand).toBe("card-cmd");
  });

  it("card branch_mode overrides merged config", () => {
    updateGlobalConfig(db, { branchMode: "current" });

    const merged = getMergedConfig(db, boardId);
    const effective = applyCardOverrides(merged, makeCard({ branch_mode: "new" }));

    expect(effective.branchMode).toBe("new");
  });

  it("card branch_name overrides merged config", () => {
    updateGlobalConfig(db, { branchName: "global-branch" });

    const merged = getMergedConfig(db, boardId);
    const effective = applyCardOverrides(merged, makeCard({ branch_name: "card-branch" }));

    expect(effective.branchName).toBe("card-branch");
  });

  it("project branch_mode overrides global, card inherits", () => {
    updateGlobalConfig(db, { branchMode: "current" });
    updateProjectConfig(db, boardId, { branchMode: "new" });

    const merged = getMergedConfig(db, boardId);
    expect(merged.branchMode).toBe("new");

    const effective = applyCardOverrides(merged, makeCard());
    expect(effective.branchMode).toBe("new");
  });

  it("card branch_mode overrides project override", () => {
    updateGlobalConfig(db, { branchMode: "current" });
    updateProjectConfig(db, boardId, { branchMode: "new" });

    const merged = getMergedConfig(db, boardId);
    const effective = applyCardOverrides(merged, makeCard({ branch_mode: "specific" }));

    expect(effective.branchMode).toBe("specific");
  });
});

import { describe, it, expect } from "bun:test";
import { buildPrompt } from "./prompt.js";
import type { CardId, BoardId } from "../types/index.js";

const baseCtx = {
  card: {
    id: "c1" as CardId,
    board_id: "b1" as BoardId,
    title: "Test card",
    description: "Do something",
    status: "in-progress" as const,
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
    assignee: "ai" as const,
    tags: [],
    files: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  board: {
    id: "b1" as BoardId,
    name: "Test",
    directory: "/tmp/test",
    description: "",
    color: null,
    scratchpad: "",
    slug: null,
    github_url: null,
    session_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  comments: [],
  config: {
    planThinking: "smart" as const,
    executeThinking: "smart" as const,
    autoCommit: false,
    autoPush: false,
    customInstructions: "",
    cliProvider: "claude" as const,
    cliCustomCommand: "",
    branchMode: "current" as const,
    branchName: "",
    model: "",
    planModel: "",
    executeModel: "",
    customTags: [] as string[],
    maxBudgetUsd: 0,
    maxConcurrentCards: 1,
  },
  phase: "execute" as const,
};

describe("buildPrompt", () => {
  it("includes attachment paths when provided", () => {
    const prompt = buildPrompt({
      ...baseCtx,
      attachmentPaths: [
        ".glue-paste/attachments/c1/screenshot.png",
        ".glue-paste/attachments/c1/mockup.jpg",
      ],
    });
    expect(prompt).toContain("## Attached Files");
    expect(prompt).toContain(".glue-paste/attachments/c1/screenshot.png");
    expect(prompt).toContain(".glue-paste/attachments/c1/mockup.jpg");
  });

  it("omits attached files section when no attachments", () => {
    const prompt = buildPrompt(baseCtx);
    expect(prompt).not.toContain("## Attached Files");
  });

  it("includes anti-re-planning instructions when planOutput is provided", () => {
    const prompt = buildPrompt({
      ...baseCtx,
      phase: "execute",
      planOutput: "## Plan\n> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development\n\nSome plan here",
    });
    expect(prompt).toContain("Do NOT create another plan");
    expect(prompt).toContain("Do NOT invoke brainstorming, writing-plans, make-plan");
    expect(prompt).toContain("Ignore any \"REQUIRED SUB-SKILL\"");
    expect(prompt).toContain("## Plan from previous step");
  });

  it("omits anti-re-planning instructions when no planOutput", () => {
    const prompt = buildPrompt({
      ...baseCtx,
      phase: "execute",
    });
    expect(prompt).not.toContain("Do NOT create another plan");
    expect(prompt).not.toContain("REQUIRED SUB-SKILL");
  });

  it("includes reference files separately from attachments", () => {
    const prompt = buildPrompt({
      ...baseCtx,
      card: { ...baseCtx.card, files: ["src/index.ts"] },
      attachmentPaths: [".glue-paste/attachments/c1/screenshot.png"],
    });
    expect(prompt).toContain("## Reference Files");
    expect(prompt).toContain("src/index.ts");
    expect(prompt).toContain("## Attached Files");
    expect(prompt).toContain(".glue-paste/attachments/c1/screenshot.png");
  });
});

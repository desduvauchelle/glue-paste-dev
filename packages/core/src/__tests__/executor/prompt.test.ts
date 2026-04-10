import { describe, test, expect } from "bun:test";
import { buildPrompt } from "../../executor/prompt.js";
import type { Board, BoardId, CardId, CardWithTags, Comment, CommentId, ConfigInput } from "../../types/index.js";

const makeBoard = (overrides?: Partial<Board>): Board => ({
  id: "board-1" as BoardId,
  name: "My Project",
  description: "A test project",
  directory: "/home/user/project",
  color: null,
  scratchpad: "",
  slug: null,
  github_url: null,
  session_id: null,
  created_at: "2024-01-01",
  updated_at: "2024-01-01",
  ...overrides,
});

const makeCard = (overrides?: Partial<CardWithTags>): CardWithTags => ({
  id: "card-1" as CardId,
  board_id: "board-1" as BoardId,
  title: "Add login page",
  description: "Build a login page with OAuth",
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
  maxConcurrentCards: 1,
  ...overrides,
});

describe("buildPrompt", () => {
  test("includes project context", () => {
    const prompt = buildPrompt({
      card: makeCard(),
      board: makeBoard(),
      comments: [],
      config: makeConfig(),
      phase: "plan",
    });

    expect(prompt).toContain("/home/user/project");
    expect(prompt).toContain("My Project");
    expect(prompt).toContain("A test project");
  });

  test("includes card title and description", () => {
    const prompt = buildPrompt({
      card: makeCard({ title: "Fix bug", description: "The bug is in auth" }),
      board: makeBoard(),
      comments: [],
      config: makeConfig(),
      phase: "plan",
    });

    expect(prompt).toContain("Fix bug");
    expect(prompt).toContain("The bug is in auth");
  });

  test("includes tags when present", () => {
    const prompt = buildPrompt({
      card: makeCard({ tags: ["UX", "backend"] }),
      board: makeBoard(),
      comments: [],
      config: makeConfig(),
      phase: "plan",
    });

    expect(prompt).toContain("## Areas: UX, backend");
  });

  test("omits tags section when empty", () => {
    const prompt = buildPrompt({
      card: makeCard({ tags: [] }),
      board: makeBoard(),
      comments: [],
      config: makeConfig(),
      phase: "plan",
    });

    expect(prompt).not.toContain("## Areas:");
  });

  test("includes reference files", () => {
    const prompt = buildPrompt({
      card: makeCard({ files: ["src/auth.ts", "src/db.ts"] }),
      board: makeBoard(),
      comments: [],
      config: makeConfig(),
      phase: "plan",
    });

    expect(prompt).toContain("## Reference Files");
    expect(prompt).toContain("- src/auth.ts");
    expect(prompt).toContain("- src/db.ts");
  });

  test("includes comments with correct labels", () => {
    const comments: Comment[] = [
      { id: "c1" as CommentId, card_id: "card-1" as CardId, author: "user", content: "Please use React", execution_id: null, created_at: "2024-01-01" },
      { id: "c2" as CommentId, card_id: "card-1" as CardId, author: "system", content: "Plan completed", execution_id: "e1", created_at: "2024-01-01" },
      { id: "c3" as CommentId, card_id: "card-1" as CardId, author: "ai", content: "I will use React", execution_id: null, created_at: "2024-01-01" },
    ];

    const prompt = buildPrompt({
      card: makeCard(),
      board: makeBoard(),
      comments,
      config: makeConfig(),
      phase: "plan",
    });

    expect(prompt).toContain("**User feedback:** Please use React");
    expect(prompt).toContain("**System:** Plan completed");
    expect(prompt).toContain("**AI:** I will use React");
  });

  test("includes custom instructions", () => {
    const prompt = buildPrompt({
      card: makeCard(),
      board: makeBoard(),
      comments: [],
      config: makeConfig({ customInstructions: "Always use TypeScript" }),
      phase: "plan",
    });

    expect(prompt).toContain("## Additional Instructions");
    expect(prompt).toContain("Always use TypeScript");
  });

  test("plan phase includes plan-specific instructions", () => {
    const prompt = buildPrompt({
      card: makeCard(),
      board: makeBoard(),
      comments: [],
      config: makeConfig(),
      phase: "plan",
    });

    expect(prompt).toContain("Do NOT make any changes yet");
    expect(prompt).toContain("create a detailed implementation plan");
  });

  test("execute phase includes execute-specific instructions", () => {
    const prompt = buildPrompt({
      card: makeCard(),
      board: makeBoard(),
      comments: [],
      config: makeConfig(),
      phase: "execute",
    });

    expect(prompt).toContain("Execute the plan above directly");
    expect(prompt).toContain("implement the changes completely");
  });

  test("execute phase includes plan output when provided", () => {
    const prompt = buildPrompt({
      card: makeCard(),
      board: makeBoard(),
      comments: [],
      config: makeConfig(),
      phase: "execute",
      planOutput: "Step 1: Create the file\nStep 2: Add tests",
    });

    expect(prompt).toContain("## Plan from previous step");
    expect(prompt).toContain("Step 1: Create the file");
  });

  test("execute phase includes commit instructions when autoCommit is true", () => {
    const prompt = buildPrompt({
      card: makeCard(),
      board: makeBoard(),
      comments: [],
      config: makeConfig({ autoCommit: true }),
      phase: "execute",
    });

    expect(prompt).toContain("Commit your changes");
    expect(prompt).toContain("Do NOT add Co-authored-by");
  });

  test("execute phase includes push instructions when autoPush is true", () => {
    const prompt = buildPrompt({
      card: makeCard(),
      board: makeBoard(),
      comments: [],
      config: makeConfig({ autoCommit: true, autoPush: true }),
      phase: "execute",
    });

    expect(prompt).toContain("Push your changes to the remote");
  });

  test("execute phase omits push when autoPush is false", () => {
    const prompt = buildPrompt({
      card: makeCard(),
      board: makeBoard(),
      comments: [],
      config: makeConfig({ autoCommit: true, autoPush: false }),
      phase: "execute",
    });

    expect(prompt).not.toContain("Push your changes");
  });

  test("omits board description when empty", () => {
    const prompt = buildPrompt({
      card: makeCard(),
      board: makeBoard({ description: "" }),
      comments: [],
      config: makeConfig(),
      phase: "plan",
    });

    expect(prompt).not.toContain("Project description:");
  });
});

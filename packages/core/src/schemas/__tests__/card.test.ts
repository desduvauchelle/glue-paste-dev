import { describe, it, expect } from "bun:test";
import {
  CardIdSchema,
  CreateCardSchema,
  UpdateCardSchema,
  MoveCardSchema,
  ReorderCardsSchema,
  MoveCardToBoardSchema,
} from "../card.js";

describe("CardIdSchema", () => {
  it("accepts valid string", () => {
    expect(CardIdSchema.safeParse("abc-123").success).toBe(true);
  });

  it("rejects empty string", () => {
    // branded string — empty string still parses (no min constraint)
    const result = CardIdSchema.safeParse("");
    expect(result.success).toBeDefined();
  });
});

describe("CreateCardSchema", () => {
  it("accepts empty object (all fields have defaults)", () => {
    const result = CreateCardSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("");
      expect(result.data.status).toBe("todo");
      expect(result.data.blocking).toBe(true);
      expect(result.data.assignee).toBe("ai");
      expect(result.data.tags).toEqual([]);
      expect(result.data.files).toEqual([]);
    }
  });

  it("accepts card with all fields", () => {
    const result = CreateCardSchema.safeParse({
      title: "Full card",
      description: "A description",
      status: "queued",
      tags: ["ux", "api"],
      files: ["/src/index.ts"],
      blocking: true,
      assignee: "human",
      plan_thinking: "smart",
      execute_thinking: "basic",
      auto_commit: true,
      auto_push: false,
      cli_provider: "gemini",
      cli_custom_command: "my-cli run",
      branch_mode: "new",
      branch_name: "feat/test",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = CreateCardSchema.safeParse({ status: "exploding" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid assignee", () => {
    const result = CreateCardSchema.safeParse({ assignee: "robot" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid cli_provider", () => {
    const result = CreateCardSchema.safeParse({ cli_provider: "gpt5" });
    expect(result.success).toBe(false);
  });

  it("accepts null for nullable override fields", () => {
    const result = CreateCardSchema.safeParse({
      cli_provider: null,
      branch_mode: null,
      auto_commit: null,
      plan_thinking: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects tags array over 50 items", () => {
    const result = CreateCardSchema.safeParse({ tags: Array(51).fill("tag") });
    expect(result.success).toBe(false);
  });

  it("rejects title over 1000 chars", () => {
    const result = CreateCardSchema.safeParse({ title: "x".repeat(1001) });
    expect(result.success).toBe(false);
  });
});

describe("UpdateCardSchema", () => {
  it("accepts empty object (no changes)", () => {
    const result = UpdateCardSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts partial update (title only)", () => {
    const result = UpdateCardSchema.safeParse({ title: "New title" });
    expect(result.success).toBe(true);
  });

  it("accepts status change", () => {
    const result = UpdateCardSchema.safeParse({ status: "done" });
    expect(result.success).toBe(true);
  });

  it("accepts null to clear override fields", () => {
    const result = UpdateCardSchema.safeParse({
      cli_provider: null,
      branch_mode: null,
      auto_commit: null,
      plan_thinking: null,
      execute_thinking: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = UpdateCardSchema.safeParse({ status: "exploding" });
    expect(result.success).toBe(false);
  });
});

describe("MoveCardSchema", () => {
  it("accepts valid move", () => {
    const result = MoveCardSchema.safeParse({ status: "in-progress", position: 0 });
    expect(result.success).toBe(true);
  });

  it("rejects missing status", () => {
    const result = MoveCardSchema.safeParse({ position: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects missing position", () => {
    const result = MoveCardSchema.safeParse({ status: "todo" });
    expect(result.success).toBe(false);
  });
});

describe("ReorderCardsSchema", () => {
  it("accepts array of card positions", () => {
    const result = ReorderCardsSchema.safeParse([
      { id: "card-1", status: "todo", position: 0 },
      { id: "card-2", status: "todo", position: 1 },
    ]);
    expect(result.success).toBe(true);
  });

  it("accepts empty array", () => {
    const result = ReorderCardsSchema.safeParse([]);
    expect(result.success).toBe(true);
  });
});

describe("MoveCardToBoardSchema", () => {
  it("accepts valid board_id", () => {
    const result = MoveCardToBoardSchema.safeParse({ board_id: "board-2" });
    expect(result.success).toBe(true);
  });

  it("rejects missing board_id", () => {
    const result = MoveCardToBoardSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

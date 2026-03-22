import { describe, it, expect } from "bun:test";
import { CreateCardSchema, UpdateCardSchema } from "../card.js";
import { CreateCommentSchema } from "../comment.js";
import { CreateBoardSchema } from "../board.js";
import { ConfigInputSchema } from "../config.js";

describe("schema security limits", () => {
  describe("card schemas", () => {
    it("rejects title over 1000 chars", () => {
      const result = CreateCardSchema.safeParse({ title: "a".repeat(1001) });
      expect(result.success).toBe(false);
    });

    it("accepts title at 1000 chars", () => {
      const result = CreateCardSchema.safeParse({ title: "a".repeat(1000) });
      expect(result.success).toBe(true);
    });

    it("rejects description over 50000 chars", () => {
      const result = CreateCardSchema.safeParse({
        title: "test",
        description: "a".repeat(50_001),
      });
      expect(result.success).toBe(false);
    });

    it("rejects tags array over 50 items", () => {
      const result = CreateCardSchema.safeParse({
        title: "test",
        tags: Array.from({ length: 51 }, (_, i) => `tag-${i}`),
      });
      expect(result.success).toBe(false);
    });

    it("rejects files array over 200 items", () => {
      const result = CreateCardSchema.safeParse({
        title: "test",
        files: Array.from({ length: 201 }, (_, i) => `file-${i}`),
      });
      expect(result.success).toBe(false);
    });

    it("rejects update title over 1000 chars", () => {
      const result = UpdateCardSchema.safeParse({ title: "a".repeat(1001) });
      expect(result.success).toBe(false);
    });
  });

  describe("comment schema", () => {
    it("rejects content over 50000 chars", () => {
      const result = CreateCommentSchema.safeParse({
        content: "a".repeat(50_001),
      });
      expect(result.success).toBe(false);
    });

    it("accepts content at 50000 chars", () => {
      const result = CreateCommentSchema.safeParse({
        content: "a".repeat(50_000),
      });
      expect(result.success).toBe(true);
    });
  });

  describe("board directory validation", () => {
    it("rejects relative paths", () => {
      const result = CreateBoardSchema.safeParse({
        name: "Test",
        directory: "relative/path",
      });
      expect(result.success).toBe(false);
    });

    it("rejects paths with '..' segments", () => {
      const result = CreateBoardSchema.safeParse({
        name: "Test",
        directory: "/home/user/../etc",
      });
      expect(result.success).toBe(false);
    });

    it("accepts absolute paths", () => {
      const result = CreateBoardSchema.safeParse({
        name: "Test",
        directory: "/home/user/projects/myapp",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("config schema", () => {
    it("rejects custom command over 1000 chars", () => {
      const result = ConfigInputSchema.safeParse({
        cliCustomCommand: "a".repeat(1001),
      });
      expect(result.success).toBe(false);
    });

    it("rejects custom instructions over 50000 chars", () => {
      const result = ConfigInputSchema.safeParse({
        customInstructions: "a".repeat(50_001),
      });
      expect(result.success).toBe(false);
    });
  });
});

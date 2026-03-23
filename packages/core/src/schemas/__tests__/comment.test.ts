import { describe, it, expect } from "bun:test";
import { CreateCommentSchema, CommentAuthor } from "../comment.js";

describe("CommentAuthor", () => {
  it("accepts all valid author types", () => {
    for (const author of ["user", "system", "ai"]) {
      expect(CommentAuthor.safeParse(author).success).toBe(true);
    }
  });

  it("rejects invalid author", () => {
    expect(CommentAuthor.safeParse("robot").success).toBe(false);
  });
});

describe("CreateCommentSchema", () => {
  it("accepts valid comment", () => {
    const result = CreateCommentSchema.safeParse({
      content: "Hello world",
      author: "user",
    });
    expect(result.success).toBe(true);
  });

  it("defaults author to user", () => {
    const result = CreateCommentSchema.safeParse({ content: "Hello" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.author).toBe("user");
    }
  });

  it("rejects empty content", () => {
    const result = CreateCommentSchema.safeParse({
      content: "",
      author: "user",
    });
    expect(result.success).toBe(false);
  });

  it("rejects content over 50000 chars", () => {
    const result = CreateCommentSchema.safeParse({
      content: "x".repeat(50_001),
      author: "user",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid author", () => {
    const result = CreateCommentSchema.safeParse({
      content: "Hello",
      author: "robot",
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional execution_id", () => {
    const result = CreateCommentSchema.safeParse({
      content: "test",
      author: "ai",
      execution_id: "exec-123",
    });
    expect(result.success).toBe(true);
  });

  it("accepts null execution_id", () => {
    const result = CreateCommentSchema.safeParse({
      content: "test",
      execution_id: null,
    });
    expect(result.success).toBe(true);
  });
});

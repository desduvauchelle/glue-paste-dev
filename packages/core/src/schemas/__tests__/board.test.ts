import { describe, it, expect } from "bun:test";
import { BoardIdSchema, CreateBoardSchema, UpdateBoardSchema } from "../board.js";

describe("BoardIdSchema", () => {
  it("accepts non-empty string", () => {
    expect(BoardIdSchema.safeParse("board-1").success).toBe(true);
  });
});

describe("CreateBoardSchema", () => {
  it("accepts valid board", () => {
    const result = CreateBoardSchema.safeParse({
      name: "My Project",
      description: "A project",
      directory: "/home/user/project",
    });
    expect(result.success).toBe(true);
  });

  it("accepts board with optional fields", () => {
    const result = CreateBoardSchema.safeParse({
      name: "Test",
      directory: "/tmp/test",
      color: "#ff0000",
      slug: "my-project",
      github_url: "https://github.com/foo/bar",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing name", () => {
    const result = CreateBoardSchema.safeParse({
      description: "A project",
      directory: "/tmp",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = CreateBoardSchema.safeParse({
      name: "",
      directory: "/tmp",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing directory", () => {
    const result = CreateBoardSchema.safeParse({
      name: "Test",
      description: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects relative directory path", () => {
    const result = CreateBoardSchema.safeParse({
      name: "Test",
      directory: "relative/path",
    });
    expect(result.success).toBe(false);
  });

  it("rejects directory with path traversal", () => {
    const result = CreateBoardSchema.safeParse({
      name: "Test",
      directory: "/home/../etc/passwd",
    });
    expect(result.success).toBe(false);
  });

  it("accepts Windows-style absolute path", () => {
    const result = CreateBoardSchema.safeParse({
      name: "Test",
      directory: "C:\\Users\\test\\project",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid slug format", () => {
    const result = CreateBoardSchema.safeParse({
      name: "Test",
      directory: "/tmp/test",
      slug: "Invalid Slug!",
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid slug", () => {
    const result = CreateBoardSchema.safeParse({
      name: "Test",
      directory: "/tmp/test",
      slug: "my-project_v2",
    });
    expect(result.success).toBe(true);
  });

  it("accepts null slug", () => {
    const result = CreateBoardSchema.safeParse({
      name: "Test",
      directory: "/tmp/test",
      slug: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("UpdateBoardSchema", () => {
  it("accepts partial update", () => {
    const result = UpdateBoardSchema.safeParse({ name: "New Name" });
    expect(result.success).toBe(true);
  });

  it("accepts empty object", () => {
    const result = UpdateBoardSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts scratchpad update", () => {
    const result = UpdateBoardSchema.safeParse({ scratchpad: "some notes" });
    expect(result.success).toBe(true);
  });

  it("rejects directory with path traversal", () => {
    const result = UpdateBoardSchema.safeParse({ directory: "/foo/../bar" });
    expect(result.success).toBe(false);
  });
});

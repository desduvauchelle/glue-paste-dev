import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../db/schema.js";
import {
  listBoards,
  getBoard,
  createBoard,
  updateBoard,
  deleteBoard,
} from "../../db/boards.js";
import type { BoardId } from "../../types/index.js";

let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  initSchema(db);
});

describe("boards", () => {
  it("should create and retrieve a board", () => {
    const board = createBoard(db, {
      name: "Test Board",
      description: "A test board",
      directory: "/tmp/test-project",
    });

    expect(board.name).toBe("Test Board");
    expect(board.description).toBe("A test board");
    expect(board.directory).toBe("/tmp/test-project");
    expect(board.session_id).toBeTruthy();
    expect(board.id).toBeTruthy();

    const fetched = getBoard(db, board.id as BoardId);
    expect(fetched).toEqual(board);
  });

  it("should list all boards", () => {
    createBoard(db, { name: "Board 1", description: "", directory: "/tmp/1" });
    createBoard(db, { name: "Board 2", description: "", directory: "/tmp/2" });

    const boards = listBoards(db);
    expect(boards).toHaveLength(2);
  });

  it("should update a board", () => {
    const board = createBoard(db, {
      name: "Original",
      description: "",
      directory: "/tmp/test",
    });

    const updated = updateBoard(db, board.id as BoardId, {
      name: "Updated Name",
    });

    expect(updated?.name).toBe("Updated Name");
    expect(updated?.directory).toBe("/tmp/test");
  });

  it("should return null when updating non-existent board", () => {
    const result = updateBoard(db, "nonexistent" as BoardId, {
      name: "Test",
    });
    expect(result).toBeNull();
  });

  it("should delete a board", () => {
    const board = createBoard(db, {
      name: "To Delete",
      description: "",
      directory: "/tmp/del",
    });

    expect(deleteBoard(db, board.id as BoardId)).toBe(true);
    expect(getBoard(db, board.id as BoardId)).toBeNull();
  });

  it("should return false when deleting non-existent board", () => {
    expect(deleteBoard(db, "nonexistent" as BoardId)).toBe(false);
  });

  it("should create a board with a slug", () => {
    const board = createBoard(db, {
      name: "Slug Board",
      description: "",
      directory: "/tmp/slug",
      slug: "my-board",
    });
    expect(board.slug).toBe("my-board");
  });

  it("should update a board slug", () => {
    const board = createBoard(db, {
      name: "Board",
      description: "",
      directory: "/tmp/slug2",
    });
    const updated = updateBoard(db, board.id as BoardId, { slug: "updated-slug" });
    expect(updated?.slug).toBe("updated-slug");
  });

  it("should allow clearing a slug to null", () => {
    const board = createBoard(db, {
      name: "Board",
      description: "",
      directory: "/tmp/slug3",
      slug: "temp-slug",
    });
    const updated = updateBoard(db, board.id as BoardId, { slug: null });
    expect(updated?.slug).toBeNull();
  });

  it("should reject duplicate slugs", () => {
    createBoard(db, { name: "A", description: "", directory: "/tmp/a", slug: "same-slug" });
    expect(() =>
      createBoard(db, { name: "B", description: "", directory: "/tmp/b", slug: "same-slug" })
    ).toThrow();
  });
});

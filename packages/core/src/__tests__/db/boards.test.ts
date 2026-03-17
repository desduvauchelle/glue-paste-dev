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
});

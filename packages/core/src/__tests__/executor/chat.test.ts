import { describe, test, expect, beforeEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../db/schema.js";
import { createBoard } from "../../db/boards.js";
import { createCard } from "../../db/cards.js";
import { listComments } from "../../db/comments.js";
import type { BoardId, CardId } from "../../types/index.js";

// Mock process-cleanup before importing chat
mock.module("../../executor/process-cleanup.js", () => ({
  killProcessTreeSync: mock(() => {}),
}));

const { killChatProcess, hasChatProcess, killAllChatProcesses } = await import(
  "../../executor/chat.js"
);

let db: Database;
let boardId: BoardId;
let cardId: CardId;
let card: any;
let board: any;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  initSchema(db);
  board = createBoard(db, { name: "Test", description: "", directory: "/tmp/test" });
  boardId = board.id as BoardId;
  card = createCard(db, boardId, { title: "Chat Card", description: "desc", tags: [] });
  cardId = card.id as CardId;
});

describe("killChatProcess", () => {
  test("returns false when no process exists for cardId", () => {
    expect(killChatProcess("nonexistent")).toBe(false);
  });
});

describe("hasChatProcess", () => {
  test("returns false for nonexistent card", () => {
    expect(hasChatProcess("nonexistent")).toBe(false);
  });
});

describe("killAllChatProcesses", () => {
  test("does not throw when no processes exist", () => {
    expect(() => killAllChatProcesses()).not.toThrow();
  });
});

describe("runChat prerequisites", () => {
  test("no comments exist before runChat is called", () => {
    const comments = listComments(db, cardId);
    expect(comments).toHaveLength(0);
  });
});

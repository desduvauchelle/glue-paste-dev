import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../db/schema.js";
import { createBoard } from "../../db/boards.js";
import { createCard } from "../../db/cards.js";
import { createExecution } from "../../db/executions.js";
import {
  listComments,
  createComment,
  addSystemComment,
  deleteComment,
} from "../../db/comments.js";
import type { BoardId, CardId, CommentId } from "../../types/index.js";

let db: Database;
let cardId: CardId;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  initSchema(db);

  const board = createBoard(db, {
    name: "Test",
    description: "",
    directory: "/tmp/test",
  });
  const card = createCard(db, board.id as BoardId, {
    title: "Test Card",
    description: "",
    tags: [],
  });
  cardId = card.id as CardId;
});

describe("comments", () => {
  it("should create a user comment", () => {
    const comment = createComment(db, cardId, {
      author: "user",
      content: "This doesn't work as expected",
    });

    expect(comment.author).toBe("user");
    expect(comment.content).toBe("This doesn't work as expected");
    expect(comment.execution_id).toBeNull();
  });

  it("should add a system comment linked to execution", () => {
    const execution = createExecution(db, cardId, null, "plan");
    const comment = addSystemComment(
      db,
      cardId,
      execution.id,
      "Execution completed successfully"
    );

    expect(comment.author).toBe("system");
    expect(comment.execution_id).toBe(execution.id);
  });

  it("should list comments in order", () => {
    createComment(db, cardId, { author: "user", content: "First" });
    createComment(db, cardId, { author: "system", content: "Second" });
    createComment(db, cardId, { author: "user", content: "Third" });

    const comments = listComments(db, cardId);
    expect(comments).toHaveLength(3);
    expect(comments[0]?.content).toBe("First");
    expect(comments[2]?.content).toBe("Third");
  });

  it("should delete a comment", () => {
    const comment = createComment(db, cardId, {
      author: "user",
      content: "Delete me",
    });

    expect(deleteComment(db, comment.id as CommentId)).toBe(true);
    expect(listComments(db, cardId)).toHaveLength(0);
  });
});

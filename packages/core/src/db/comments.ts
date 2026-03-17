import type { Database } from "bun:sqlite";
import type { Comment, CommentId, CardId, CreateComment } from "../types/index.js";
import { CreateCommentSchema } from "../schemas/comment.js";

export function listComments(db: Database, cardId: CardId): Comment[] {
  return db
    .query(
      "SELECT * FROM comments WHERE card_id = ? ORDER BY created_at ASC"
    )
    .all(cardId) as Comment[];
}

export function getComment(db: Database, id: CommentId): Comment | null {
  return (
    (db.query("SELECT * FROM comments WHERE id = ?").get(id) as Comment | null) ??
    null
  );
}

export function createComment(
  db: Database,
  cardId: CardId,
  rawInput: CreateComment
): Comment {
  const input = CreateCommentSchema.parse(rawInput);
  const row = db
    .query(
      `INSERT INTO comments (card_id, author, content, execution_id)
       VALUES (?, ?, ?, ?)
       RETURNING *`
    )
    .get(cardId, input.author, input.content, input.execution_id) as Comment;
  return row;
}

export function deleteComment(db: Database, id: CommentId): boolean {
  const result = db.query("DELETE FROM comments WHERE id = ?").run(id);
  return result.changes > 0;
}

export function deleteAllCommentsForCard(db: Database, cardId: CardId): number {
  const result = db.query("DELETE FROM comments WHERE card_id = ?").run(cardId);
  return result.changes;
}

/** Add a system comment for an execution result */
export function addSystemComment(
  db: Database,
  cardId: CardId,
  executionId: string,
  content: string
): Comment {
  return createComment(db, cardId, {
    author: "system",
    content,
    execution_id: executionId,
  });
}

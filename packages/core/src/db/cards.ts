import type { Database } from "bun:sqlite";
import type {
  Card,
  CardId,
  CardWithTags,
  CreateCard,
  UpdateCard,
  MoveCard,
  ReorderCards,
  BoardId,
  CardStatusType,
} from "../types/index.js";
import { CreateCardSchema } from "../schemas/card.js";

interface CardRow {
  id: string;
  board_id: string;
  title: string;
  description: string;
  status: string;
  position: number;
  blocking: number;
  plan_thinking: string | null;
  execute_thinking: string | null;
  auto_commit: number | null;
  created_at: string;
  updated_at: string;
}

function getTagsForCard(db: Database, cardId: string): string[] {
  const rows = db
    .query("SELECT tag FROM card_tags WHERE card_id = ? ORDER BY tag")
    .all(cardId) as Array<{ tag: string }>;
  return rows.map((r) => r.tag);
}

function setTagsForCard(
  db: Database,
  cardId: string,
  tags: string[]
): void {
  db.query("DELETE FROM card_tags WHERE card_id = ?").run(cardId);
  const stmt = db.query(
    "INSERT INTO card_tags (card_id, tag) VALUES (?, ?)"
  );
  for (const tag of tags) {
    stmt.run(cardId, tag);
  }
}

function toCardWithTags(db: Database, row: CardRow): CardWithTags {
  return {
    ...row,
    blocking: Boolean(row.blocking),
    plan_thinking: row.plan_thinking as "smart" | "basic" | null,
    execute_thinking: row.execute_thinking as "smart" | "basic" | null,
    auto_commit: row.auto_commit === null ? null : row.auto_commit !== 0,
    tags: getTagsForCard(db, row.id),
  } as CardWithTags;
}

export function listCards(db: Database, boardId: BoardId): CardWithTags[] {
  const rows = db
    .query(
      "SELECT * FROM cards WHERE board_id = ? ORDER BY position ASC, created_at ASC"
    )
    .all(boardId) as CardRow[];
  return rows.map((row) => toCardWithTags(db, row));
}

export function listCardsByStatus(
  db: Database,
  boardId: BoardId,
  status: CardStatusType
): CardWithTags[] {
  const rows = db
    .query(
      "SELECT * FROM cards WHERE board_id = ? AND status = ? ORDER BY position ASC"
    )
    .all(boardId, status) as CardRow[];
  return rows.map((row) => toCardWithTags(db, row));
}

export function getCard(db: Database, id: CardId): CardWithTags | null {
  const row = db
    .query("SELECT * FROM cards WHERE id = ?")
    .get(id) as CardRow | null;
  if (!row) return null;
  return toCardWithTags(db, row);
}

export function createCard(
  db: Database,
  boardId: BoardId,
  rawInput: CreateCard
): CardWithTags {
  const input = CreateCardSchema.parse(rawInput);
  // Get next position if not specified
  const status = input.status ?? "todo";
  const position =
    input.position ??
    ((
      db
        .query(
          "SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM cards WHERE board_id = ? AND status = ?"
        )
        .get(boardId, status) as { next_pos: number }
    ).next_pos);

  const row = db
    .query(
      `INSERT INTO cards (board_id, title, description, status, position, blocking, plan_thinking, execute_thinking, auto_commit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .get(boardId, input.title, input.description, status, position, input.blocking ? 1 : 0, input.plan_thinking ?? null, input.execute_thinking ?? null, input.auto_commit === undefined ? null : input.auto_commit === null ? null : (input.auto_commit ? 1 : 0)) as CardRow;

  if (input.tags.length > 0) {
    setTagsForCard(db, row.id, input.tags);
  }

  return toCardWithTags(db, row);
}

export function updateCard(
  db: Database,
  id: CardId,
  input: UpdateCard
): CardWithTags | null {
  const current = db
    .query("SELECT * FROM cards WHERE id = ?")
    .get(id) as CardRow | null;
  if (!current) return null;

  const title = input.title ?? current.title;
  const description = input.description ?? current.description;
  const status = input.status ?? current.status;
  const position = input.position ?? current.position;
  const blocking = input.blocking !== undefined ? (input.blocking ? 1 : 0) : current.blocking;
  const planThinking = input.plan_thinking !== undefined ? input.plan_thinking : current.plan_thinking;
  const executeThinking = input.execute_thinking !== undefined ? input.execute_thinking : current.execute_thinking;
  const autoCommit = input.auto_commit !== undefined
    ? (input.auto_commit === null ? null : (input.auto_commit ? 1 : 0))
    : current.auto_commit;

  const row = db
    .query(
      `UPDATE cards SET title = ?, description = ?, status = ?, position = ?, blocking = ?, plan_thinking = ?, execute_thinking = ?, auto_commit = ?, updated_at = datetime('now')
       WHERE id = ?
       RETURNING *`
    )
    .get(title, description, status, position, blocking, planThinking, executeThinking, autoCommit, id) as CardRow;

  if (input.tags !== undefined) {
    setTagsForCard(db, row.id, input.tags);
  }

  return toCardWithTags(db, row);
}

export function moveCard(
  db: Database,
  id: CardId,
  move: MoveCard
): CardWithTags | null {
  const row = db
    .query(
      `UPDATE cards SET status = ?, position = ?, updated_at = datetime('now')
       WHERE id = ?
       RETURNING *`
    )
    .get(move.status, move.position, id) as CardRow | null;
  if (!row) return null;
  return toCardWithTags(db, row);
}

export function reorderCards(db: Database, updates: ReorderCards): void {
  const stmt = db.prepare(
    "UPDATE cards SET status = ?, position = ?, updated_at = datetime('now') WHERE id = ?"
  );
  const tx = db.transaction(() => {
    for (const u of updates) {
      stmt.run(u.status, u.position, u.id);
    }
  });
  tx();
}

export function deleteCard(db: Database, id: CardId): boolean {
  const result = db.query("DELETE FROM cards WHERE id = ?").run(id);
  return result.changes > 0;
}

export function updateCardStatus(
  db: Database,
  id: CardId,
  status: CardStatusType
): void {
  db.query(
    "UPDATE cards SET status = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(status, id);
}

export function resetStaleCards(db: Database): number {
  const result = db
    .query(
      "UPDATE cards SET status = 'todo' WHERE status IN ('in-progress', 'queued')"
    )
    .run();
  return result.changes;
}

export function recoverInterruptedCards(db: Database): { requeued: number; reset: number } {
  const inProgressIds = db
    .query("SELECT id FROM cards WHERE status = 'in-progress'")
    .all() as Array<{ id: string }>;

  let requeued = 0;
  let reset = 0;

  for (const { id } of inProgressIds) {
    // Cancel any running executions for this card
    db.query(
      "UPDATE executions SET status = 'cancelled', finished_at = datetime('now') WHERE card_id = ? AND status = 'running'"
    ).run(id);

    // Check if a plan phase completed successfully
    const planDone = db
      .query(
        "SELECT id FROM executions WHERE card_id = ? AND phase = 'plan' AND status = 'success' ORDER BY started_at DESC LIMIT 1"
      )
      .get(id);

    if (planDone) {
      db.query("UPDATE cards SET status = 'queued', updated_at = datetime('now') WHERE id = ?").run(id);
      requeued++;
    } else {
      db.query("UPDATE cards SET status = 'todo', updated_at = datetime('now') WHERE id = ?").run(id);
      reset++;
    }
  }

  return { requeued, reset };
}

export function countActiveCards(db: Database): number {
  const row = db
    .query(
      "SELECT COUNT(*) as count FROM cards WHERE status IN ('queued', 'in-progress')"
    )
    .get() as { count: number };
  return row.count;
}

export function getDistinctTags(db: Database, boardId: BoardId): string[] {
  const rows = db
    .query(
      `SELECT DISTINCT ct.tag FROM card_tags ct
       JOIN cards c ON c.id = ct.card_id
       WHERE c.board_id = ?
       ORDER BY ct.tag`
    )
    .all(boardId) as Array<{ tag: string }>;
  return rows.map((r) => r.tag);
}

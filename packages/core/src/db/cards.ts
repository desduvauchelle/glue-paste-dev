import type { Database } from "bun:sqlite";
import type {
  Card,
  CardId,
  CardWithTags,
  CreateCard,
  UpdateCard,
  MoveCard,
  BoardId,
  CardStatusType,
} from "../types/index.js";

interface CardRow {
  id: string;
  board_id: string;
  title: string;
  description: string;
  status: string;
  position: number;
  blocking: number;
  thinking_level: string | null;
  plan_mode: number | null;
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
    thinking_level: row.thinking_level as "smart" | "basic" | null,
    plan_mode: row.plan_mode === null ? null : Boolean(row.plan_mode),
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
  input: CreateCard
): CardWithTags {
  // Get next position if not specified
  const position =
    input.position ??
    ((
      db
        .query(
          "SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM cards WHERE board_id = ? AND status = 'todo'"
        )
        .get(boardId) as { next_pos: number }
    ).next_pos);

  const row = db
    .query(
      `INSERT INTO cards (board_id, title, description, position, blocking, thinking_level, plan_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .get(boardId, input.title, input.description, position, input.blocking ? 1 : 0, input.thinking_level ?? null, input.plan_mode === null || input.plan_mode === undefined ? null : input.plan_mode ? 1 : 0) as CardRow;

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
  const thinkingLevel = input.thinking_level !== undefined ? input.thinking_level : current.thinking_level;
  const planMode = input.plan_mode !== undefined ? (input.plan_mode === null ? null : input.plan_mode ? 1 : 0) : current.plan_mode;

  const row = db
    .query(
      `UPDATE cards SET title = ?, description = ?, status = ?, position = ?, blocking = ?, thinking_level = ?, plan_mode = ?, updated_at = datetime('now')
       WHERE id = ?
       RETURNING *`
    )
    .get(title, description, status, position, blocking, thinkingLevel, planMode, id) as CardRow;

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
      "UPDATE cards SET status = 'todo' WHERE status IN ('queued', 'in-progress')"
    )
    .run();
  return result.changes;
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

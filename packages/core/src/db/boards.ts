import type { Database } from "bun:sqlite";
import type { Board, BoardId, CreateBoard, UpdateBoard } from "../types/index.js";

export function listBoards(db: Database): Board[] {
  return db
    .query("SELECT * FROM boards ORDER BY updated_at DESC")
    .all() as Board[];
}

export function getBoard(db: Database, id: BoardId): Board | null {
  return (
    (db.query("SELECT * FROM boards WHERE id = ?").get(id) as Board | null) ??
    null
  );
}

export function createBoard(db: Database, input: CreateBoard): Board {
  const sessionId = crypto.randomUUID();
  const row = db
    .query(
      `INSERT INTO boards (name, description, directory, session_id, color, slug, github_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .get(
      input.name,
      input.description,
      input.directory,
      sessionId,
      input.color ?? null,
      input.slug ?? null,
      input.github_url ?? null
    ) as Board;
  return row;
}

export function updateBoard(
  db: Database,
  id: BoardId,
  input: UpdateBoard
): Board | null {
  const current = getBoard(db, id);
  if (!current) return null;

  const name = input.name ?? current.name;
  const description = input.description ?? current.description;
  const directory = input.directory ?? current.directory;
  const color = input.color !== undefined ? input.color : current.color;
  const scratchpad = input.scratchpad ?? current.scratchpad;
  const slug = input.slug !== undefined ? input.slug : current.slug;
  const githubUrl = input.github_url !== undefined ? input.github_url : current.github_url;

  const row = db
    .query(
      `UPDATE boards SET name = ?, description = ?, directory = ?, color = ?, scratchpad = ?, slug = ?, github_url = ?, updated_at = datetime('now')
       WHERE id = ?
       RETURNING *`
    )
    .get(name, description, directory, color, scratchpad, slug, githubUrl, id) as Board;
  return row;
}

export function deleteBoard(db: Database, id: BoardId): boolean {
  const result = db.query("DELETE FROM boards WHERE id = ?").run(id);
  return result.changes > 0;
}

import type { Database } from "bun:sqlite";
import type {
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
  auto_push: number | null;
  cli_provider: string | null;
  cli_custom_command: string | null;
  branch_mode: string | null;
  branch_name: string | null;
  assignee: string;
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

function getFilesForCard(db: Database, cardId: string): string[] {
  const rows = db
    .query("SELECT file_path FROM card_files WHERE card_id = ? ORDER BY file_path")
    .all(cardId) as Array<{ file_path: string }>;
  return rows.map((r) => r.file_path);
}

function setFilesForCard(
  db: Database,
  cardId: string,
  files: string[]
): void {
  db.query("DELETE FROM card_files WHERE card_id = ?").run(cardId);
  const stmt = db.query(
    "INSERT INTO card_files (card_id, file_path) VALUES (?, ?)"
  );
  for (const filePath of files) {
    stmt.run(cardId, filePath);
  }
}

function toCardWithTags(db: Database, row: CardRow): CardWithTags {
  return {
    ...row,
    blocking: Boolean(row.blocking),
    plan_thinking: row.plan_thinking as "smart" | "basic" | null,
    execute_thinking: row.execute_thinking as "smart" | "basic" | null,
    auto_commit: row.auto_commit === null ? null : row.auto_commit !== 0,
    auto_push: row.auto_push === null ? null : row.auto_push !== 0,
    cli_provider: (row.cli_provider ?? null) as CardWithTags["cli_provider"],
    cli_custom_command: row.cli_custom_command ?? null,
    branch_mode: (row.branch_mode ?? null) as CardWithTags["branch_mode"],
    branch_name: row.branch_name ?? null,
    assignee: (row.assignee ?? "ai") as "ai" | "human",
    tags: getTagsForCard(db, row.id),
    files: getFilesForCard(db, row.id),
  } as CardWithTags;
}

export function listCards(
  db: Database,
  boardId: BoardId,
  options?: { doneLimit?: number }
): { cards: CardWithTags[]; doneHasMore: boolean } {
  const doneLimit = options?.doneLimit ?? 20;

  const nonDoneRows = db
    .query(
      "SELECT * FROM cards WHERE board_id = ? AND status != 'done' ORDER BY position ASC, created_at ASC"
    )
    .all(boardId) as CardRow[];

  const doneRows = db
    .query(
      "SELECT * FROM cards WHERE board_id = ? AND status = 'done' ORDER BY updated_at DESC LIMIT ?"
    )
    .all(boardId, doneLimit + 1) as CardRow[];

  const doneHasMore = doneRows.length > doneLimit;
  const limitedDoneRows = doneRows.slice(0, doneLimit);

  const cards = [...nonDoneRows, ...limitedDoneRows].map((row) =>
    toCardWithTags(db, row)
  );
  return { cards, doneHasMore };
}

export function listCardsByStatus(
  db: Database,
  boardId: BoardId,
  status: CardStatusType
): CardWithTags[] {
  const rows = db
    .query(
      "SELECT * FROM cards WHERE board_id = ? AND status = ? ORDER BY position ASC, created_at ASC"
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
      `INSERT INTO cards (board_id, title, description, status, position, blocking, plan_thinking, execute_thinking, auto_commit, auto_push, cli_provider, cli_custom_command, branch_mode, branch_name, assignee)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .get(boardId, input.title, input.description, status, position, input.blocking ? 1 : 0, input.plan_thinking ?? null, input.execute_thinking ?? null, input.auto_commit === undefined ? null : input.auto_commit === null ? null : (input.auto_commit ? 1 : 0), input.auto_push === undefined ? null : input.auto_push === null ? null : (input.auto_push ? 1 : 0), input.cli_provider ?? null, input.cli_custom_command ?? null, input.branch_mode ?? null, input.branch_name ?? null, input.assignee ?? "ai") as CardRow;

  if (input.tags.length > 0) {
    setTagsForCard(db, row.id, input.tags);
  }
  if (input.files.length > 0) {
    setFilesForCard(db, row.id, input.files);
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
  const autoPush = input.auto_push !== undefined
    ? (input.auto_push === null ? null : (input.auto_push ? 1 : 0))
    : current.auto_push;
  const cliProvider = input.cli_provider !== undefined ? input.cli_provider : current.cli_provider;
  const cliCustomCommand = input.cli_custom_command !== undefined ? input.cli_custom_command : current.cli_custom_command;
  const branchMode = input.branch_mode !== undefined ? input.branch_mode : current.branch_mode;
  const branchName = input.branch_name !== undefined ? input.branch_name : current.branch_name;
  const assignee = input.assignee ?? current.assignee;

  const row = db
    .query(
      `UPDATE cards SET title = ?, description = ?, status = ?, position = ?, blocking = ?, plan_thinking = ?, execute_thinking = ?, auto_commit = ?, auto_push = ?, cli_provider = ?, cli_custom_command = ?, branch_mode = ?, branch_name = ?, assignee = ?, updated_at = datetime('now')
       WHERE id = ?
       RETURNING *`
    )
    .get(title, description, status, position, blocking, planThinking, executeThinking, autoCommit, autoPush, cliProvider, cliCustomCommand, branchMode, branchName, assignee, id) as CardRow;

  if (input.tags !== undefined) {
    setTagsForCard(db, row.id, input.tags);
  }
  if (input.files !== undefined) {
    setFilesForCard(db, row.id, input.files);
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

export function moveCardToBoard(
  db: Database,
  cardId: string,
  targetBoardId: string
): CardWithTags | null {
  const nextPos = (
    db
      .query(
        "SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM cards WHERE board_id = ? AND status = 'todo'"
      )
      .get(targetBoardId) as { next_pos: number }
  ).next_pos;

  const row = db
    .query(
      `UPDATE cards SET board_id = ?, status = 'todo', position = ?, updated_at = datetime('now')
       WHERE id = ?
       RETURNING *`
    )
    .get(targetBoardId, nextPos, cardId) as CardRow | null;
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

export function countCardsByStatusAllBoards(
  db: Database
): Record<string, Record<CardStatusType, number>> {
  const rows = db
    .query("SELECT board_id, status, COUNT(*) as count FROM cards GROUP BY board_id, status")
    .all() as Array<{ board_id: string; status: string; count: number }>;

  const result: Record<string, Record<CardStatusType, number>> = {};
  const statuses: CardStatusType[] = ["todo", "queued", "in-progress", "done", "failed"];

  for (const row of rows) {
    if (!result[row.board_id]) {
      result[row.board_id] = { todo: 0, queued: 0, "in-progress": 0, done: 0, failed: 0 };
    }
    if (statuses.includes(row.status as CardStatusType)) {
      result[row.board_id]![row.status as CardStatusType] = row.count;
    }
  }

  return result;
}

export function countDonePerDay(
  db: Database,
  days: number = 14,
  tzOffsetMinutes: number = 0
): Array<{ date: string; count: number }> {
  const modifier = `${-tzOffsetMinutes} minutes`;

  const rows = db
    .query(
      `SELECT date(updated_at, ?) as day, COUNT(*) as count
       FROM cards
       WHERE status = 'done'
         AND date(updated_at, ?) >= date('now', ?, '-' || ? || ' days')
       GROUP BY date(updated_at, ?)
       ORDER BY day ASC`
    )
    .all(modifier, modifier, modifier, days, modifier) as Array<{ day: string; count: number }>;

  const map = new Map(rows.map((r) => [r.day, r.count]));
  const result: Array<{ date: string; count: number }> = [];
  const localNow = new Date(Date.now() - tzOffsetMinutes * 60 * 1000);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(localNow);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    result.push({ date: key, count: map.get(key) ?? 0 });
  }

  return result;
}

export function countDonePerDayByBoard(
  db: Database,
  days: number = 14
): Record<string, Array<{ date: string; count: number }>> {
  const rows = db
    .query(
      `SELECT board_id, date(updated_at) as day, COUNT(*) as count
       FROM cards
       WHERE status = 'done' AND updated_at >= date('now', '-' || ? || ' days')
       GROUP BY board_id, date(updated_at)
       ORDER BY board_id, day ASC`
    )
    .all(days) as Array<{ board_id: string; day: string; count: number }>;

  // Group by board_id
  const byBoard = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (!byBoard.has(row.board_id)) byBoard.set(row.board_id, new Map());
    byBoard.get(row.board_id)!.set(row.day, row.count);
  }

  // Zero-fill gaps for each board
  const result: Record<string, Array<{ date: string; count: number }>> = {};
  const now = new Date();
  for (const [boardId, map] of byBoard) {
    const series: Array<{ date: string; count: number }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      series.push({ date: key, count: map.get(key) ?? 0 });
    }
    result[boardId] = series;
  }

  return result;
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

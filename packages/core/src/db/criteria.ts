import type { Database } from "bun:sqlite";
import type { CardId, Criterion, CriterionId, ExecutionId } from "../types/index.js";

interface CriterionRow {
  id: string;
  card_id: string;
  text: string;
  status: string;
  source: string;
  evidence: string | null;
  execution_id: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

function toCriterion(row: CriterionRow): Criterion {
  return {
    ...row,
    status: row.status as Criterion["status"],
    source: row.source as Criterion["source"],
    evidence: row.evidence ?? null,
    execution_id: row.execution_id ?? null,
  } as Criterion;
}

export function getCriteria(db: Database, cardId: CardId): Criterion[] {
  const rows = db
    .query("SELECT * FROM card_criteria WHERE card_id = ? ORDER BY position ASC, created_at ASC")
    .all(cardId) as CriterionRow[];
  return rows.map(toCriterion);
}

export function getCriterion(db: Database, id: CriterionId): Criterion | null {
  const row = db.query("SELECT * FROM card_criteria WHERE id = ?").get(id) as CriterionRow | null;
  return row ? toCriterion(row) : null;
}

/** Insert AI-generated criteria only when the card has none yet (idempotent seeding). */
export function seedCriteria(db: Database, cardId: CardId, texts: string[]): Criterion[] {
  const existing = getCriteria(db, cardId);
  if (existing.length > 0) return existing;
  const stmt = db.query(
    "INSERT INTO card_criteria (card_id, text, source, position) VALUES (?, ?, 'ai', ?) RETURNING *"
  );
  const results: Criterion[] = [];
  const tx = db.transaction(() => {
    texts.forEach((text, i) => {
      const row = stmt.get(cardId, text, i) as CriterionRow;
      results.push(toCriterion(row));
    });
  });
  tx();
  return results;
}

export function setCriterionResult(
  db: Database,
  id: CriterionId,
  status: "pass" | "fail",
  evidence: string,
  executionId: ExecutionId | null
): void {
  db.query(
    "UPDATE card_criteria SET status = ?, evidence = ?, execution_id = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(status, evidence, executionId, id);
}

export function createCriterion(db: Database, cardId: CardId, text: string): Criterion {
  const nextPos = (
    db
      .query("SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM card_criteria WHERE card_id = ?")
      .get(cardId) as { next_pos: number }
  ).next_pos;
  const row = db
    .query(
      "INSERT INTO card_criteria (card_id, text, source, position) VALUES (?, ?, 'user', ?) RETURNING *"
    )
    .get(cardId, text, nextPos) as CriterionRow;
  return toCriterion(row);
}

export function updateCriterion(
  db: Database,
  id: CriterionId,
  input: { text?: string; status?: "pending" | "pass" | "fail" }
): Criterion | null {
  const current = db.query("SELECT * FROM card_criteria WHERE id = ?").get(id) as CriterionRow | null;
  if (!current) return null;
  const text = input.text ?? current.text;
  const status = input.status ?? current.status;
  const row = db
    .query(
      "UPDATE card_criteria SET text = ?, status = ?, updated_at = datetime('now') WHERE id = ? RETURNING *"
    )
    .get(text, status, id) as CriterionRow;
  return toCriterion(row);
}

export function deleteCriterion(db: Database, id: CriterionId): boolean {
  const result = db.query("DELETE FROM card_criteria WHERE id = ?").run(id);
  return result.changes > 0;
}

export function reorderCriteria(
  db: Database,
  updates: Array<{ id: CriterionId; position: number }>
): void {
  const stmt = db.query(
    "UPDATE card_criteria SET position = ?, updated_at = datetime('now') WHERE id = ?"
  );
  const tx = db.transaction(() => {
    for (const u of updates) stmt.run(u.position, u.id);
  });
  tx();
}

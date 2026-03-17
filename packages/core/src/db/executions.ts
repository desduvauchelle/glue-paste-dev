import type { Database } from "bun:sqlite";
import type {
  Execution,
  ExecutionId,
  CardId,
  ExecutionPhaseType,
  ExecutionStatusType,
} from "../types/index.js";

export function listExecutions(
  db: Database,
  cardId: CardId
): Execution[] {
  return db
    .query(
      "SELECT * FROM executions WHERE card_id = ? ORDER BY started_at DESC"
    )
    .all(cardId) as Execution[];
}

export function getExecution(
  db: Database,
  id: ExecutionId
): Execution | null {
  return (
    (db
      .query("SELECT * FROM executions WHERE id = ?")
      .get(id) as Execution | null) ?? null
  );
}

export function createExecution(
  db: Database,
  cardId: CardId,
  sessionId: string | null,
  phase: ExecutionPhaseType
): Execution {
  const row = db
    .query(
      `INSERT INTO executions (card_id, session_id, phase)
       VALUES (?, ?, ?)
       RETURNING *`
    )
    .get(cardId, sessionId, phase) as Execution;
  return row;
}

export function updateExecutionStatus(
  db: Database,
  id: ExecutionId,
  status: ExecutionStatusType,
  exitCode: number | null
): void {
  db.query(
    `UPDATE executions
     SET status = ?, exit_code = ?, finished_at = datetime('now')
     WHERE id = ?`
  ).run(status, exitCode, id);
}

export function updateExecutionPid(
  db: Database,
  id: ExecutionId,
  pid: number
): void {
  db.query("UPDATE executions SET pid = ? WHERE id = ?").run(pid, id);
}

export function appendExecutionOutput(
  db: Database,
  id: ExecutionId,
  chunk: string
): void {
  db.query(
    "UPDATE executions SET output = output || ? WHERE id = ?"
  ).run(chunk, id);
}

export function updateExecutionCost(
  db: Database,
  id: ExecutionId,
  costUsd: number
): void {
  db.query("UPDATE executions SET cost_usd = ? WHERE id = ?").run(
    costUsd,
    id
  );
}

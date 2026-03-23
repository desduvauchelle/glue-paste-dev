import type { Database } from "bun:sqlite";
import type { CardId, ExecutionId, FileChange } from "../types/index.js";

export interface CommitId extends String {
  readonly __brand: "CommitId";
}

export interface CardCommit {
  id: string;
  card_id: string;
  execution_id: string | null;
  sha: string;
  message: string;
  author_name: string;
  author_email: string;
  files_changed: string | null;
  created_at: string;
}

export interface CreateCommitInput {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  filesChanged: FileChange[];
}

export function listCommits(
  db: Database,
  cardId: CardId
): CardCommit[] {
  return db
    .query(
      "SELECT * FROM card_commits WHERE card_id = ? ORDER BY created_at DESC"
    )
    .all(cardId) as CardCommit[];
}

export function addCommit(
  db: Database,
  cardId: CardId,
  executionId: ExecutionId | null,
  input: CreateCommitInput
): CardCommit {
  const row = db
    .query(
      `INSERT INTO card_commits (card_id, execution_id, sha, message, author_name, author_email, files_changed)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .get(
      cardId,
      executionId,
      input.sha,
      input.message,
      input.authorName,
      input.authorEmail,
      JSON.stringify(input.filesChanged)
    ) as CardCommit;
  return row;
}

export function addCommits(
  db: Database,
  cardId: CardId,
  executionId: ExecutionId | null,
  inputs: CreateCommitInput[]
): CardCommit[] {
  const results: CardCommit[] = [];
  const stmt = db.query(
    `INSERT INTO card_commits (card_id, execution_id, sha, message, author_name, author_email, files_changed)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING *`
  );
  const tx = db.transaction(() => {
    for (const input of inputs) {
      const row = stmt.get(
        cardId,
        executionId,
        input.sha,
        input.message,
        input.authorName,
        input.authorEmail,
        JSON.stringify(input.filesChanged)
      ) as CardCommit;
      results.push(row);
    }
  });
  tx();
  return results;
}

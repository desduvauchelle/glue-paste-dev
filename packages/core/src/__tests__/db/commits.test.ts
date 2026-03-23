import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../db/schema.js";
import { createBoard } from "../../db/boards.js";
import { createCard } from "../../db/cards.js";
import { listCommits, addCommit, addCommits } from "../../db/commits.js";
import type { BoardId, CardId } from "../../types/index.js";

let db: Database;
let boardId: BoardId;
let cardId: CardId;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  initSchema(db);

  const board = createBoard(db, { name: "Test", description: "", directory: "/tmp/test" });
  boardId = board.id as BoardId;

  const card = createCard(db, boardId, {
    title: "Test Card",
    tags: [],
  });
  cardId = card.id as CardId;
});

describe("commits db", () => {
  it("returns empty list for card with no commits", () => {
    const commits = listCommits(db, cardId);
    expect(commits).toEqual([]);
  });

  it("adds a single commit and retrieves it", () => {
    const commit = addCommit(db, cardId, null, {
      sha: "abc123",
      message: "initial commit",
      authorName: "Test User",
      authorEmail: "test@example.com",
      filesChanged: [],
    });

    expect(commit.card_id).toBe(cardId);
    expect(commit.sha).toBe("abc123");
    expect(commit.message).toBe("initial commit");
    expect(commit.author_name).toBe("Test User");
    expect(commit.author_email).toBe("test@example.com");
    expect(commit.id).toBeTruthy();

    const commits = listCommits(db, cardId);
    expect(commits).toHaveLength(1);
    expect(commits[0]!.sha).toBe("abc123");
  });

  it("adds multiple commits in a batch", () => {
    const inputs = [
      { sha: "aaa111", message: "first", authorName: "A", authorEmail: "a@x.com", filesChanged: [] },
      {
        sha: "bbb222",
        message: "second",
        authorName: "B",
        authorEmail: "b@x.com",
        filesChanged: [{ path: "src/index.ts", additions: 5, deletions: 2 }],
      },
    ];
    const commits = addCommits(db, cardId, null, inputs);
    expect(commits).toHaveLength(2);

    const all = listCommits(db, cardId);
    expect(all).toHaveLength(2);
  });

  it("stores file changes as JSON string", () => {
    const changes = [{ path: "a.ts", additions: 1, deletions: 0 }];
    addCommit(db, cardId, null, {
      sha: "ccc333",
      message: "add file",
      authorName: "Test",
      authorEmail: "t@x.com",
      filesChanged: changes,
    });

    const commits = listCommits(db, cardId);
    expect(commits[0]!.files_changed).toBe(JSON.stringify(changes));
  });

  it("returns all commits for the card", () => {
    addCommit(db, cardId, null, {
      sha: "first",
      message: "1st",
      authorName: "A",
      authorEmail: "a@x.com",
      filesChanged: [],
    });
    addCommit(db, cardId, null, {
      sha: "second",
      message: "2nd",
      authorName: "A",
      authorEmail: "a@x.com",
      filesChanged: [],
    });

    const commits = listCommits(db, cardId);
    expect(commits).toHaveLength(2);
    const shas = commits.map((c) => c.sha);
    expect(shas).toContain("first");
    expect(shas).toContain("second");
  });

  it("returns null execution_id when none provided", () => {
    const commit = addCommit(db, cardId, null, {
      sha: "ddd",
      message: "test",
      authorName: "A",
      authorEmail: "a@x.com",
      filesChanged: [],
    });
    expect(commit.execution_id).toBeNull();
  });
});

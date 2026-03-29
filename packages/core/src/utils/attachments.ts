import type { Database } from "bun:sqlite";
import type { BoardId, CardId } from "../types/index.js";
import * as boardsDb from "../db/boards.js";
import * as cardsDb from "../db/cards.js";
import { resolve, join } from "path";
import { rmSync, readdirSync, statSync } from "fs";
import { log } from "../logger.js";

export function cleanupCardAttachments(db: Database, cardId: CardId): void {
  const card = cardsDb.getCard(db, cardId);
  if (!card) return;
  const board = boardsDb.getBoard(db, card.board_id);
  if (!board) return;
  const attachmentsDir = join(resolve(board.directory), ".glue-paste", "attachments", cardId);
  try {
    rmSync(attachmentsDir, { recursive: true, force: true });
    log.info("attachments", `Cleaned up attachments for card ${cardId}`);
  } catch {
    // directory may not exist
  }
}

export function cleanupStaleAttachments(projectDir: string, maxAgeDays: number = 7): void {
  const attachmentsRoot = join(resolve(projectDir), ".glue-paste", "attachments");
  let cardDirs: string[];
  try {
    cardDirs = readdirSync(attachmentsRoot);
  } catch {
    return;
  }

  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

  for (const cardDir of cardDirs) {
    const cardPath = join(attachmentsRoot, cardDir);
    try {
      const files = readdirSync(cardPath);
      if (files.length === 0) {
        rmSync(cardPath, { recursive: true, force: true });
        continue;
      }
      const allStale = files.every((file) => {
        try {
          const stat = statSync(join(cardPath, file));
          return stat.mtimeMs < cutoff;
        } catch {
          return true;
        }
      });
      if (allStale) {
        rmSync(cardPath, { recursive: true, force: true });
        log.info("attachments", `Cleaned up stale attachments for card ${cardDir}`);
      }
    } catch {
      // skip unreadable directories
    }
  }
}

/**
 * Enforce a per-project file cap on attachments.
 * When the total number of files exceeds maxFiles, delete the oldest files
 * from completed cards (done/failed) until under the limit.
 * Never touches attachments on active/queued/todo cards.
 */
export function enforceAttachmentCap(db: Database, boardId: BoardId, maxFiles: number = 100): void {
  const board = boardsDb.getBoard(db, boardId);
  if (!board) return;

  const attachmentsRoot = join(resolve(board.directory), ".glue-paste", "attachments");
  let cardDirs: string[];
  try {
    cardDirs = readdirSync(attachmentsRoot);
  } catch {
    return; // no attachments directory
  }

  // Get all completed card IDs for this board
  const completedCards = new Set<string>();
  for (const c of cardsDb.listCardsByStatus(db, boardId, "done")) completedCards.add(c.id);
  for (const c of cardsDb.listCardsByStatus(db, boardId, "failed")) completedCards.add(c.id);

  // Collect all files with metadata
  const allFiles: { fullPath: string; mtimeMs: number; isCompleted: boolean }[] = [];

  for (const cardDir of cardDirs) {
    const cardPath = join(attachmentsRoot, cardDir);
    try {
      const files = readdirSync(cardPath);
      const completed = completedCards.has(cardDir);
      for (const file of files) {
        const fullPath = join(cardPath, file);
        try {
          const stat = statSync(fullPath);
          allFiles.push({ fullPath, mtimeMs: stat.mtimeMs, isCompleted: completed });
        } catch {
          // skip unreadable files
        }
      }
    } catch {
      // skip unreadable directories
    }
  }

  if (allFiles.length <= maxFiles) return;

  // Sort completed files oldest-first for deletion priority
  const deletable = allFiles
    .filter((f) => f.isCompleted)
    .sort((a, b) => a.mtimeMs - b.mtimeMs);

  let toDelete = allFiles.length - maxFiles;
  let deleted = 0;

  for (const file of deletable) {
    if (toDelete <= 0) break;
    try {
      rmSync(file.fullPath);
      toDelete--;
      deleted++;
    } catch {
      // skip
    }
  }

  // Clean up empty card directories
  for (const cardDir of cardDirs) {
    const cardPath = join(attachmentsRoot, cardDir);
    try {
      const remaining = readdirSync(cardPath);
      if (remaining.length === 0) {
        rmSync(cardPath, { recursive: true, force: true });
      }
    } catch {
      // skip
    }
  }

  if (deleted > 0) {
    log.info("attachments", `Cleaned up ${deleted} attachment files for board ${boardId} (cap: ${maxFiles})`);
  }
}

import type { Database } from "bun:sqlite";
import type { CardId } from "../types/index.js";
import * as boardsDb from "../db/boards.js";
import * as cardsDb from "../db/cards.js";
import { resolve, join } from "path";
import { rmSync } from "fs";
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

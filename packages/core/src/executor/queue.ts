import type { Database } from "bun:sqlite";
import type { BoardId, CardId, CardWithTags } from "../types/index.js";
import * as boardsDb from "../db/boards.js";
import * as cardsDb from "../db/cards.js";
import * as commentsDb from "../db/comments.js";
import { getMergedConfig } from "../config/manager.js";
import { runCard, type RunnerCallbacks } from "./runner.js";

export interface QueueState {
  boardId: string;
  queue: string[];
  current: string | null;
  isRunning: boolean;
}

export interface QueueCallbacks extends RunnerCallbacks {
  onQueueUpdated: (boardId: string, queue: string[], current: string | null) => void;
  onQueueStopped: (boardId: string, reason: string) => void;
}

const queues = new Map<string, QueueState>();
const activeProcesses = new Map<string, AbortController>();

export function getQueueState(boardId: string): QueueState {
  return (
    queues.get(boardId) ?? {
      boardId,
      queue: [],
      current: null,
      isRunning: false,
    }
  );
}

/** Start sequential execution of all todo cards for a board */
export async function startQueue(
  db: Database,
  boardId: BoardId,
  callbacks: QueueCallbacks
): Promise<void> {
  const board = boardsDb.getBoard(db, boardId);
  if (!board) throw new Error(`Board ${boardId} not found`);

  const todoCards = cardsDb.listCardsByStatus(db, boardId, "todo");
  if (todoCards.length === 0) {
    callbacks.onQueueStopped(boardId, "No todo cards to execute");
    return;
  }

  // Set all todo cards to queued
  for (const card of todoCards) {
    cardsDb.updateCardStatus(db, card.id as CardId, "queued");
    const updated = cardsDb.getCard(db, card.id as CardId);
    if (updated) callbacks.onCardUpdated(updated);
  }

  const cardIds = todoCards.map((c) => c.id);
  const state: QueueState = {
    boardId,
    queue: cardIds.slice(1),
    current: cardIds[0] ?? null,
    isRunning: true,
  };
  queues.set(boardId, state);
  callbacks.onQueueUpdated(boardId, state.queue, state.current);

  // Process queue
  await processQueue(db, boardId, callbacks);
}

/** Execute a single card (independent of the queue) */
export async function executeSingleCard(
  db: Database,
  cardId: CardId,
  callbacks: QueueCallbacks
): Promise<void> {
  const card = cardsDb.getCard(db, cardId);
  if (!card) throw new Error(`Card ${cardId} not found`);

  const board = boardsDb.getBoard(db, card.board_id as BoardId);
  if (!board) throw new Error(`Board ${card.board_id} not found`);

  const comments = commentsDb.listComments(db, cardId);
  const config = getMergedConfig(db, card.board_id as BoardId);

  const result = await runCard(db, card, board, comments, config, callbacks);

  if (result.success) {
    cardsDb.updateCardStatus(db, cardId, "done");
  } else {
    // Retry once
    const retryResult = await runCard(db, card, board, comments, config, callbacks);
    cardsDb.updateCardStatus(db, cardId, retryResult.success ? "done" : "failed");
  }

  const updated = cardsDb.getCard(db, cardId);
  if (updated) callbacks.onCardUpdated(updated);
}

/** Stop the queue for a board */
export function stopQueue(
  boardId: string,
  callbacks: QueueCallbacks
): void {
  const state = queues.get(boardId);
  if (!state) return;

  state.isRunning = false;
  state.queue = [];
  state.current = null;
  queues.set(boardId, state);

  const controller = activeProcesses.get(boardId);
  if (controller) {
    controller.abort();
    activeProcesses.delete(boardId);
  }

  callbacks.onQueueStopped(boardId, "Stopped by user");
}

async function processQueue(
  db: Database,
  boardId: string,
  callbacks: QueueCallbacks
): Promise<void> {
  const state = queues.get(boardId);
  if (!state || !state.isRunning || !state.current) {
    callbacks.onQueueStopped(boardId, "Queue completed");
    return;
  }

  const cardId = state.current as CardId;
  const card = cardsDb.getCard(db, cardId);
  if (!card) {
    // Skip missing card
    advanceQueue(db, boardId, callbacks);
    return;
  }

  const board = boardsDb.getBoard(db, boardId as BoardId);
  if (!board) return;

  const comments = commentsDb.listComments(db, cardId);
  const config = getMergedConfig(db, boardId as BoardId);

  // Run the card
  const result = await runCard(db, card, board, comments, config, callbacks);

  if (result.success) {
    cardsDb.updateCardStatus(db, cardId, "done");
    const updated = cardsDb.getCard(db, cardId);
    if (updated) callbacks.onCardUpdated(updated);
    advanceQueue(db, boardId, callbacks);
  } else {
    // Retry once
    const retryComments = commentsDb.listComments(db, cardId);
    const retryResult = await runCard(db, card, board, retryComments, config, callbacks);

    if (retryResult.success) {
      cardsDb.updateCardStatus(db, cardId, "done");
      const updated = cardsDb.getCard(db, cardId);
      if (updated) callbacks.onCardUpdated(updated);
      advanceQueue(db, boardId, callbacks);
    } else {
      // Failed after retry
      cardsDb.updateCardStatus(db, cardId, "failed");
      const updated = cardsDb.getCard(db, cardId);
      if (updated) callbacks.onCardUpdated(updated);

      if (card.blocking) {
        // Blocking card: stop the entire queue
        const queueState = queues.get(boardId);
        if (queueState) {
          for (const queuedId of queueState.queue) {
            cardsDb.updateCardStatus(db, queuedId as CardId, "todo");
            const resetCard = cardsDb.getCard(db, queuedId as CardId);
            if (resetCard) callbacks.onCardUpdated(resetCard);
          }
          queueState.isRunning = false;
          queueState.queue = [];
          queueState.current = null;
        }

        callbacks.onQueueStopped(
          boardId,
          `Card "${card.title}" failed after retry (blocking)`
        );
      } else {
        // Non-blocking card: continue to next card
        advanceQueue(db, boardId, callbacks);
      }
    }
  }
}

function advanceQueue(
  db: Database,
  boardId: string,
  callbacks: QueueCallbacks
): void {
  const state = queues.get(boardId);
  if (!state || !state.isRunning) return;

  if (state.queue.length === 0) {
    state.isRunning = false;
    state.current = null;
    queues.set(boardId, state);
    callbacks.onQueueStopped(boardId, "All cards completed");
    return;
  }

  state.current = state.queue.shift() ?? null;
  queues.set(boardId, state);
  callbacks.onQueueUpdated(boardId, state.queue, state.current);

  // Continue processing (async, don't await here to avoid stack overflow on long queues)
  void processQueue(db, boardId, callbacks);
}

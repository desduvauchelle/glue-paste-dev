import type { Database } from "bun:sqlite";
import type { BoardId, CardId, CardWithTags, ConfigInput } from "../types/index.js";
import * as boardsDb from "../db/boards.js";
import * as cardsDb from "../db/cards.js";
import * as commentsDb from "../db/comments.js";
import { getMergedConfig } from "../config/manager.js";
import { runCard, killCardProcess, type RunnerCallbacks } from "./runner.js";
import type { RateLimitInfo } from "./rate-limit.js";
import { log } from "../logger.js";

export interface QueueState {
  boardId: string;
  queue: string[];
  current: string | null;
  isRunning: boolean;
  isPaused: boolean;
}

export interface QueueCallbacks extends RunnerCallbacks {
  onQueueUpdated: (boardId: string, queue: string[], current: string | null, isPaused: boolean) => void;
  onQueueStopped: (boardId: string, reason: string) => void;
  onRateLimited?: (boardId: string, cardTitle: string, resetMessage?: string) => void;
}

const THINKING_LEVEL_MODELS: Record<string, string> = {
  smart: "claude-opus-4-6",
  basic: "claude-sonnet-4-6",
};

/** Apply per-card thinking_level and plan_mode overrides to config */
function applyCardOverrides(
  config: Required<ConfigInput>,
  card: CardWithTags
): Required<ConfigInput> {
  const thinkingLevel = card.thinking_level ?? config.thinkingLevel ?? "smart";
  const model = THINKING_LEVEL_MODELS[thinkingLevel] || config.model;
  const planMode = card.plan_mode !== null && card.plan_mode !== undefined ? card.plan_mode : config.planMode;

  return { ...config, model, planMode, thinkingLevel };
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
      isPaused: false,
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
  log.info("queue", `Starting queue for board ${boardId} with ${todoCards.length} todo cards`);
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
    isPaused: false,
  };
  queues.set(boardId, state);
  callbacks.onQueueUpdated(boardId, state.queue, state.current, state.isPaused);

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

  log.info("queue", `Executing single card "${card.title}" (${cardId})`);
  const comments = commentsDb.listComments(db, cardId);
  const config = applyCardOverrides(getMergedConfig(db, card.board_id as BoardId), card);

  const result = await runCard(db, card, board, comments, config, callbacks);

  if (result.success) {
    cardsDb.updateCardStatus(db, cardId, "done");
  } else if (result.rateLimitInfo?.isRateLimit) {
    cardsDb.updateCardStatus(db, cardId, "rate-limited");
    const resetMsg = result.rateLimitInfo.resetMessage;
    const comment = commentsDb.addSystemComment(db, cardId, "", `Rate limited. ${resetMsg ?? "Check provider dashboard for reset time."}`);
    callbacks.onCommentAdded(comment);
    callbacks.onRateLimited?.(card.board_id, card.title, resetMsg);
  } else {
    log.warn("queue", `Card ${cardId} failed, retrying once`);
    const retryResult = await runCard(db, card, board, comments, config, callbacks);
    if (retryResult.rateLimitInfo?.isRateLimit) {
      cardsDb.updateCardStatus(db, cardId, "rate-limited");
      const resetMsg = retryResult.rateLimitInfo.resetMessage;
      const comment = commentsDb.addSystemComment(db, cardId, "", `Rate limited. ${resetMsg ?? "Check provider dashboard for reset time."}`);
      callbacks.onCommentAdded(comment);
      callbacks.onRateLimited?.(card.board_id, card.title, resetMsg);
    } else {
      cardsDb.updateCardStatus(db, cardId, retryResult.success ? "done" : "failed");
    }
  }

  const updated = cardsDb.getCard(db, cardId);
  if (updated) callbacks.onCardUpdated(updated);
}

/** Stop a single card's running process */
export function stopCard(
  db: Database,
  cardId: CardId,
  callbacks: QueueCallbacks
): void {
  const killed = killCardProcess(cardId);
  if (killed) {
    log.info("queue", `Stopped card ${cardId}`);
  }
  cardsDb.updateCardStatus(db, cardId, "todo");
  const updated = cardsDb.getCard(db, cardId);
  if (updated) callbacks.onCardUpdated(updated);
}

/** Pause the queue — current card finishes, but next card won't start */
export function pauseQueue(
  boardId: string,
  callbacks: QueueCallbacks
): void {
  const state = queues.get(boardId);
  if (!state || !state.isRunning) return;

  state.isPaused = true;
  queues.set(boardId, state);
  log.info("queue", `Queue paused for board ${boardId}`);
  callbacks.onQueueUpdated(boardId, state.queue, state.current, state.isPaused);
}

/** Resume a paused queue */
export function resumeQueue(
  db: Database,
  boardId: string,
  callbacks: QueueCallbacks
): void {
  const state = queues.get(boardId);
  if (!state || !state.isPaused) return;

  state.isPaused = false;
  queues.set(boardId, state);
  log.info("queue", `Queue resumed for board ${boardId}`);
  callbacks.onQueueUpdated(boardId, state.queue, state.current, state.isPaused);

  // If the current card already finished while paused, advance now
  if (state.isRunning && !state.current) {
    advanceQueue(db, boardId, callbacks);
  }
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

  log.info("queue", `Queue stopped by user for board ${boardId}`);
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
  const config = applyCardOverrides(getMergedConfig(db, boardId as BoardId), card);

  // Run the card
  const result = await runCard(db, card, board, comments, config, callbacks);

  if (result.success) {
    cardsDb.updateCardStatus(db, cardId, "done");
    const updated = cardsDb.getCard(db, cardId);
    if (updated) callbacks.onCardUpdated(updated);
    advanceQueue(db, boardId, callbacks);
  } else if (result.rateLimitInfo?.isRateLimit) {
    // Rate limited — don't retry, pause the queue
    handleRateLimited(db, boardId, card, result.rateLimitInfo.resetMessage, callbacks);
  } else {
    // Retry once
    const retryComments = commentsDb.listComments(db, cardId);
    const retryResult = await runCard(db, card, board, retryComments, config, callbacks);

    if (retryResult.success) {
      cardsDb.updateCardStatus(db, cardId, "done");
      const updated = cardsDb.getCard(db, cardId);
      if (updated) callbacks.onCardUpdated(updated);
      advanceQueue(db, boardId, callbacks);
    } else if (retryResult.rateLimitInfo?.isRateLimit) {
      handleRateLimited(db, boardId, card, retryResult.rateLimitInfo.resetMessage, callbacks);
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

function handleRateLimited(
  db: Database,
  boardId: string,
  card: CardWithTags,
  resetMessage: string | undefined,
  callbacks: QueueCallbacks
): void {
  const cardId = card.id as CardId;
  cardsDb.updateCardStatus(db, cardId, "rate-limited");
  const msg = resetMessage ?? "Check provider dashboard for reset time.";
  const comment = commentsDb.addSystemComment(db, cardId, "", `Rate limited. ${msg}`);
  callbacks.onCommentAdded(comment);

  const updated = cardsDb.getCard(db, cardId);
  if (updated) callbacks.onCardUpdated(updated);

  // Pause the queue — all subsequent cards will likely hit the same limit
  const state = queues.get(boardId);
  if (state) {
    state.isPaused = true;
    queues.set(boardId, state);
    callbacks.onQueueUpdated(boardId, state.queue, null, true);
  }

  callbacks.onRateLimited?.(boardId, card.title, resetMessage);
  log.warn("queue", `Rate limited on card "${card.title}". Queue paused. ${msg}`);
}

function advanceQueue(
  db: Database,
  boardId: string,
  callbacks: QueueCallbacks
): void {
  const state = queues.get(boardId);
  if (!state || !state.isRunning) return;

  // If paused, hold here — resumeQueue will call advanceQueue again
  if (state.isPaused) {
    state.current = null;
    queues.set(boardId, state);
    callbacks.onQueueUpdated(boardId, state.queue, state.current, state.isPaused);
    return;
  }

  if (state.queue.length === 0) {
    state.isRunning = false;
    state.current = null;
    state.isPaused = false;
    queues.set(boardId, state);
    callbacks.onQueueStopped(boardId, "All cards completed");
    return;
  }

  state.current = state.queue.shift() ?? null;
  queues.set(boardId, state);
  callbacks.onQueueUpdated(boardId, state.queue, state.current, state.isPaused);

  // Continue processing (async, don't await here to avoid stack overflow on long queues)
  void processQueue(db, boardId, callbacks);
}

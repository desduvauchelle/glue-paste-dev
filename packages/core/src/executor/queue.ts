import type { Database } from "bun:sqlite";
import type { BoardId, CardId, CardWithTags, ConfigInput } from "../types/index.js";
import * as boardsDb from "../db/boards.js";
import * as cardsDb from "../db/cards.js";
import * as commentsDb from "../db/comments.js";
import * as executionsDb from "../db/executions.js";
import { getMergedConfig } from "../config/manager.js";
import { runCard, killCardProcess, type RunnerCallbacks } from "./runner.js";
import type { RateLimitInfo } from "./rate-limit.js";
import { log } from "../logger.js";
import { cardLabel } from "../utils/cardLabel.js";

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
  onRateLimited?: (boardId: string, cardTitle: string, retryInSeconds: number, resetMessage?: string) => void;
  onOverloaded?: (boardId: string, cardTitle: string, retryInSeconds: number) => void;
}

/** Apply per-card overrides (plan_thinking, execute_thinking, auto_commit) to config */
export function applyCardOverrides(
  config: Required<ConfigInput>,
  card: CardWithTags
): Required<ConfigInput> {
  const planThinking = card.plan_thinking !== null && card.plan_thinking !== undefined ? card.plan_thinking : config.planThinking;
  const executeThinking = card.execute_thinking ?? config.executeThinking ?? "smart";
  const autoCommit = card.auto_commit !== null && card.auto_commit !== undefined ? card.auto_commit : config.autoCommit;
  const autoPush = card.auto_push !== null && card.auto_push !== undefined ? card.auto_push : config.autoPush;

  return { ...config, planThinking, executeThinking, autoCommit, autoPush };
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

  const queuedCards = cardsDb.listCardsByStatus(db, boardId, "queued");
  log.info("queue", `Starting queue for board ${boardId} with ${queuedCards.length} queued cards`);
  if (queuedCards.length === 0) {
    callbacks.onQueueStopped(boardId, "No queued cards to execute");
    return;
  }

  const cardIds = queuedCards.map((c) => c.id);
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

  log.info("queue", `Executing single card "${cardLabel(card)}" (${cardId})`);
  const comments = commentsDb.listComments(db, cardId);
  const config = applyCardOverrides(getMergedConfig(db, card.board_id as BoardId), card);

  const existingPlanOutput = executionsDb.getCompletedPlanOutput(db, cardId) ?? undefined;
  const result = await runCard(db, card, board, comments, config, callbacks, existingPlanOutput ? { existingPlanOutput } : undefined);

  if (result.success) {
    cardsDb.updateCardStatus(db, cardId, "done");
  } else if (result.rateLimitInfo?.isRateLimit) {
    notifyRateLimitOrOverload(db, card, result.rateLimitInfo, callbacks);
  } else {
    log.warn("queue", `Card ${cardId} failed, retrying once`);
    const retryResult = await runCard(db, card, board, comments, config, callbacks);
    if (retryResult.rateLimitInfo?.isRateLimit) {
      notifyRateLimitOrOverload(db, card, retryResult.rateLimitInfo, callbacks);
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

  // Run the card (reuse existing plan output if available from a recovered execution)
  const existingPlanOutput = executionsDb.getCompletedPlanOutput(db, cardId) ?? undefined;
  const result = await runCard(db, card, board, comments, config, callbacks, existingPlanOutput ? { existingPlanOutput } : undefined);

  if (result.success) {
    cardsDb.updateCardStatus(db, cardId, "done");
    const updated = cardsDb.getCard(db, cardId);
    if (updated) callbacks.onCardUpdated(updated);
    advanceQueue(db, boardId, callbacks);
  } else if (result.rateLimitInfo?.isRateLimit) {
    // Rate limited — don't retry, pause the queue
    handleRateLimited(db, boardId, card, result.rateLimitInfo, callbacks);
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
      handleRateLimited(db, boardId, card, retryResult.rateLimitInfo, callbacks);
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
          `Card "${cardLabel(card)}" failed after retry (blocking)`
        );
      } else {
        // Non-blocking card: continue to next card
        advanceQueue(db, boardId, callbacks);
      }
    }
  }
}

/** Parse seconds from a reset message like "Retry after 30 seconds" */
function parseRetrySeconds(resetMessage?: string): number {
  if (!resetMessage) return 60;
  const match = resetMessage.match(/(\d+)\s*(seconds?|minutes?|hours?)/i);
  if (!match || !match[1] || !match[2]) return 60;
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (unit.startsWith("minute")) return value * 60;
  if (unit.startsWith("hour")) return value * 3600;
  return value;
}

/** Notify rate-limit or overload for a single-card execution (no queue) */
function notifyRateLimitOrOverload(
  db: Database,
  card: CardWithTags,
  rateLimitInfo: RateLimitInfo,
  callbacks: QueueCallbacks
): void {
  const cardId = card.id as CardId;
  cardsDb.updateCardStatus(db, cardId, "queued");
  const retrySeconds = parseRetrySeconds(rateLimitInfo.resetMessage);
  if (rateLimitInfo.isOverloaded) {
    const comment = commentsDb.addSystemComment(db, cardId, "", `Claude servers are overloaded. Retrying in ${retrySeconds}s.`);
    callbacks.onCommentAdded(comment);
    callbacks.onOverloaded?.(card.board_id, cardLabel(card), retrySeconds);
  } else {
    const msg = rateLimitInfo.resetMessage ?? "Check provider dashboard for reset time.";
    const comment = commentsDb.addSystemComment(db, cardId, "", `Rate limited. Retrying in ${retrySeconds}s. ${msg}`);
    callbacks.onCommentAdded(comment);
    callbacks.onRateLimited?.(card.board_id, cardLabel(card), retrySeconds, rateLimitInfo.resetMessage);
  }
}

function handleRateLimited(
  db: Database,
  boardId: string,
  card: CardWithTags,
  rateLimitInfo: RateLimitInfo,
  callbacks: QueueCallbacks
): void {
  const cardId = card.id as CardId;
  cardsDb.updateCardStatus(db, cardId, "queued");

  const retrySeconds = parseRetrySeconds(rateLimitInfo.resetMessage);

  if (rateLimitInfo.isOverloaded) {
    const comment = commentsDb.addSystemComment(db, cardId, "", `Claude servers are overloaded. Retrying in ${retrySeconds}s.`);
    callbacks.onCommentAdded(comment);
    callbacks.onOverloaded?.(boardId, cardLabel(card), retrySeconds);
  } else {
    const msg = rateLimitInfo.resetMessage ?? "Check provider dashboard for reset time.";
    const comment = commentsDb.addSystemComment(db, cardId, "", `Rate limited. Retrying in ${retrySeconds}s. ${msg}`);
    callbacks.onCommentAdded(comment);
    callbacks.onRateLimited?.(boardId, cardLabel(card), retrySeconds, rateLimitInfo.resetMessage);
  }

  const updated = cardsDb.getCard(db, cardId);
  if (updated) callbacks.onCardUpdated(updated);

  // Pause the queue and schedule auto-resume
  const state = queues.get(boardId);
  if (state) {
    state.isPaused = true;
    queues.set(boardId, state);
    callbacks.onQueueUpdated(boardId, state.queue, null, true);
  }

  log.warn("queue", `${rateLimitInfo.isOverloaded ? "Overloaded" : "Rate limited"} on card "${cardLabel(card)}". Queue paused, auto-resuming in ${retrySeconds}s.`);

  // Auto-resume after delay
  setTimeout(() => {
    const currentState = queues.get(boardId);
    if (currentState?.isPaused && currentState.isRunning) {
      log.info("queue", `Auto-resuming queue for board ${boardId} after rate limit delay`);
      resumeQueue(db, boardId, callbacks);
    }
  }, retrySeconds * 1000);
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
    // Re-check DB for newly queued cards (added while queue was running)
    const newQueued = cardsDb.listCardsByStatus(db, boardId as BoardId, "queued");
    if (newQueued.length > 0) {
      state.queue = newQueued.map((c) => c.id);
    } else {
      state.isRunning = false;
      state.current = null;
      state.isPaused = false;
      queues.set(boardId, state);
      callbacks.onQueueStopped(boardId, "All cards completed");
      return;
    }
  }

  state.current = state.queue.shift() ?? null;
  queues.set(boardId, state);
  callbacks.onQueueUpdated(boardId, state.queue, state.current, state.isPaused);

  // Continue processing (async, don't await here to avoid stack overflow on long queues)
  void processQueue(db, boardId, callbacks);
}

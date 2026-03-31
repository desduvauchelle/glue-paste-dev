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
import { cleanupCardAttachments, cleanupStaleAttachments, enforceAttachmentCap } from "../utils/attachments.js";
import { walCheckpoint } from "../db/connection.js";

export interface QueueState {
  boardId: string;
  queue: string[];
  /** Currently executing card IDs (supports concurrent execution) */
  active: string[];
  /** @deprecated Use `active[0]` — kept for backward compatibility in WS events */
  current: string | null;
  isRunning: boolean;
  isPaused: boolean;
}

export interface QueueCallbacks extends RunnerCallbacks {
  onQueueUpdated: (boardId: string, queue: string[], current: string | null, isPaused: boolean, active?: string[]) => void;
  onQueueStopped: (boardId: string, reason: string) => void;
  onRateLimited?: (boardId: string, cardTitle: string, retryInSeconds: number, resetMessage?: string) => void;
  onOverloaded?: (boardId: string, cardTitle: string, retryInSeconds: number) => void;
}

/** Apply per-card overrides (plan_thinking, execute_thinking, auto_commit, cli_provider, branch_mode, etc.) to config */
export function applyCardOverrides(
  config: Required<ConfigInput>,
  card: CardWithTags
): Required<ConfigInput> {
  let planThinking: "smart" | "basic" | null;
  if (card.plan_thinking === "none") {
    planThinking = null;
  } else if (card.plan_thinking !== null && card.plan_thinking !== undefined) {
    planThinking = card.plan_thinking;
  } else {
    planThinking = config.planThinking ?? null;
  }
  const executeThinking = (card.execute_thinking !== null && card.execute_thinking !== undefined ? card.execute_thinking : config.executeThinking) ?? "smart";
  const autoCommit = card.auto_commit !== null && card.auto_commit !== undefined ? card.auto_commit : config.autoCommit;
  const autoPush = card.auto_push !== null && card.auto_push !== undefined ? card.auto_push : config.autoPush;
  const cliProvider = card.cli_provider !== null && card.cli_provider !== undefined ? card.cli_provider : config.cliProvider;
  const cliCustomCommand = card.cli_custom_command !== null && card.cli_custom_command !== undefined ? card.cli_custom_command : config.cliCustomCommand;
  const branchMode = card.branch_mode !== null && card.branch_mode !== undefined ? card.branch_mode : config.branchMode;
  const branchName = card.branch_name !== null && card.branch_name !== undefined ? card.branch_name : config.branchName;

  return { ...config, planThinking, executeThinking, autoCommit, autoPush, cliProvider, cliCustomCommand, branchMode, branchName };
}

const queues = new Map<string, QueueState>();
const activeProcesses = new Map<string, AbortController>();

/** Track cards that were explicitly stopped — prevents processCard from retrying or overriding status */
const stoppedCardIds = new Set<string>();

/** Check if a card was explicitly stopped (and consume the flag) */
export function consumeStoppedFlag(cardId: string): boolean {
  return stoppedCardIds.delete(cardId);
}

/** Check if a card is marked as stopped (without consuming) */
export function isCardStopped(cardId: string): boolean {
  return stoppedCardIds.has(cardId);
}

/** Helper: sync the deprecated `current` field from `active` */
function syncCurrent(state: QueueState): void {
  state.current = state.active[0] ?? null;
}

/** Notify WS clients about queue state */
function broadcastQueueState(state: QueueState, callbacks: QueueCallbacks): void {
  callbacks.onQueueUpdated(state.boardId, state.queue, state.current, state.isPaused, [...state.active]);
}

/** Return board IDs that currently have a running queue */
export function getRunningQueueBoardIds(): string[] {
  return [...queues.entries()]
    .filter(([, s]) => s.isRunning)
    .map(([id]) => id);
}

export function getQueueState(boardId: string): QueueState {
  return (
    queues.get(boardId) ?? {
      boardId,
      queue: [],
      active: [],
      current: null,
      isRunning: false,
      isPaused: false,
    }
  );
}

/** Start execution of all queued cards for a board (up to maxConcurrentCards at a time) */
export async function startQueue(
  db: Database,
  boardId: BoardId,
  callbacks: QueueCallbacks
): Promise<void> {
  const board = boardsDb.getBoard(db, boardId);
  if (!board) throw new Error(`Board ${boardId} not found`);

  // Clean up stale attachments from cards that never completed (7 day TTL)
  cleanupStaleAttachments(board.directory, 7);

  // Enforce attachment file cap (delete oldest from completed cards when over limit)
  enforceAttachmentCap(db, boardId);

  const allQueuedCards = cardsDb.listCardsByStatus(db, boardId, "queued");
  const queuedCards = allQueuedCards.filter((c) => c.assignee !== "human");
  log.info("queue", `Starting queue for board ${boardId} with ${queuedCards.length} queued cards (${allQueuedCards.length - queuedCards.length} human-assigned skipped)`);
  if (queuedCards.length === 0) {
    callbacks.onQueueStopped(boardId, "No queued cards to execute");
    return;
  }

  const config = getMergedConfig(db, boardId);
  const maxConcurrent = Math.min(Math.max(config.maxConcurrentCards ?? 1, 1), 3);

  const cardIds = queuedCards.map((c) => c.id);
  const initialActive = cardIds.slice(0, maxConcurrent);
  const remaining = cardIds.slice(maxConcurrent);

  const state: QueueState = {
    boardId,
    queue: remaining,
    active: initialActive,
    current: initialActive[0] ?? null,
    isRunning: true,
    isPaused: false,
  };
  queues.set(boardId, state);
  broadcastQueueState(state, callbacks);

  // Launch all initial cards concurrently
  for (const cardId of initialActive) {
    void processCard(db, boardId, cardId as CardId, callbacks);
  }
}

/** Execute a single card (independent of the queue) */
export async function executeSingleCard(
  db: Database,
  cardId: CardId,
  callbacks: QueueCallbacks
): Promise<void> {
  const card = cardsDb.getCard(db, cardId);
  if (!card) throw new Error(`Card ${cardId} not found`);
  if (card.assignee === "human") throw new Error(`Card ${cardId} is assigned to a human and cannot be executed by AI`);
  if (card.status === "todo") throw new Error(`Card ${cardId} has status "todo" (backlog) and cannot be executed directly — move it to "queued" first`);

  const board = boardsDb.getBoard(db, card.board_id as BoardId);
  if (!board) throw new Error(`Board ${card.board_id} not found`);

  log.info("queue", `Executing single card "${cardLabel(card)}" (${cardId})`);
  const comments = commentsDb.listComments(db, cardId);
  const config = applyCardOverrides(getMergedConfig(db, card.board_id as BoardId), card);

  try {
    const existingPlanOutput = executionsDb.getCompletedPlanOutput(db, cardId) ?? undefined;
    const result = await runCard(db, card, board, comments, config, callbacks, existingPlanOutput ? { existingPlanOutput } : undefined);

    // If stopped while running, don't retry or override status
    if (consumeStoppedFlag(cardId)) {
      log.info("queue", `Single card ${cardId} was stopped — skipping post-execution handling`);
      const updated = cardsDb.getCard(db, cardId);
      if (updated) callbacks.onCardUpdated(updated);
      return;
    }

    if (result.success) {
      cardsDb.updateCardStatus(db, cardId, "done");
      enforceAttachmentCap(db, card.board_id as BoardId);
    } else if (result.rateLimitInfo?.isRateLimit) {
      notifyRateLimitOrOverload(db, card, result.rateLimitInfo, callbacks);
    } else {
      log.warn("queue", `Card ${cardId} failed, retrying once`);
      const retryResult = await runCard(db, card, board, comments, config, callbacks);

      // Check again after retry
      if (consumeStoppedFlag(cardId)) {
        log.info("queue", `Single card ${cardId} was stopped during retry — skipping post-execution handling`);
        const updated = cardsDb.getCard(db, cardId);
        if (updated) callbacks.onCardUpdated(updated);
        return;
      }

      if (retryResult.rateLimitInfo?.isRateLimit) {
        notifyRateLimitOrOverload(db, card, retryResult.rateLimitInfo, callbacks);
      } else {
        cardsDb.updateCardStatus(db, cardId, retryResult.success ? "done" : "failed");
        if (retryResult.success) enforceAttachmentCap(db, card.board_id as BoardId);
      }
    }
  } catch (err) {
    log.error("queue", `Unexpected error executing card ${cardId}:`, err);
    if (!consumeStoppedFlag(cardId)) {
      cardsDb.updateCardStatus(db, cardId, "failed");
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
  // Mark as stopped BEFORE killing — processCard checks this flag to avoid retrying
  stoppedCardIds.add(cardId);

  const killed = killCardProcess(cardId);
  if (killed) {
    log.info("queue", `Stopped card ${cardId}`);
  }
  cardsDb.updateCardStatus(db, cardId, "todo");

  // Remove from queue active list so fillSlots doesn't wait for it
  for (const [boardId, state] of queues) {
    if (state.active.includes(cardId)) {
      removeFromActive(boardId, cardId);
      broadcastQueueState(state, callbacks);
      break;
    }
  }

  const updated = cardsDb.getCard(db, cardId);
  if (updated) callbacks.onCardUpdated(updated);
}

/** Pause the queue — active cards finish, but no new cards start */
export function pauseQueue(
  boardId: string,
  callbacks: QueueCallbacks
): void {
  const state = queues.get(boardId);
  if (!state || !state.isRunning) return;

  state.isPaused = true;
  queues.set(boardId, state);
  log.info("queue", `Queue paused for board ${boardId}`);
  broadcastQueueState(state, callbacks);
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
  broadcastQueueState(state, callbacks);

  // If active cards finished while paused, fill slots now
  if (state.isRunning && state.active.length === 0) {
    fillSlots(db, boardId, callbacks);
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
  state.active = [];
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

/** Process a single card within the queue context */
async function processCard(
  db: Database,
  boardId: string,
  cardId: CardId,
  callbacks: QueueCallbacks
): Promise<void> {
  const state = queues.get(boardId);
  if (!state || !state.isRunning) return;

  const card = cardsDb.getCard(db, cardId);
  if (!card || card.assignee === "human" || card.status === "todo") {
    if (card?.status === "todo") {
      log.warn("queue", `Skipping card "${cardLabel(card)}" — status is "todo" (backlog)`);
    }
    removeFromActive(boardId, cardId);
    fillSlots(db, boardId, callbacks);
    return;
  }

  const board = boardsDb.getBoard(db, boardId as BoardId);
  if (!board) {
    removeFromActive(boardId, cardId);
    fillSlots(db, boardId, callbacks);
    return;
  }

  const comments = commentsDb.listComments(db, cardId);
  const config = applyCardOverrides(getMergedConfig(db, boardId as BoardId), card);

  try {
    const existingPlanOutput = executionsDb.getCompletedPlanOutput(db, cardId) ?? undefined;
    const result = await runCard(db, card, board, comments, config, callbacks, existingPlanOutput ? { existingPlanOutput } : undefined);

    // If the card was explicitly stopped while running, don't retry or override status
    if (consumeStoppedFlag(cardId)) {
      log.info("queue", `Card ${cardId} was stopped — skipping post-execution handling`);
      removeFromActive(boardId, cardId);
      fillSlots(db, boardId, callbacks);
      return;
    }

    if (result.success) {
      cardsDb.updateCardStatus(db, cardId, "done");
      enforceAttachmentCap(db, card.board_id as BoardId);
      walCheckpoint(db);
      const updated = cardsDb.getCard(db, cardId);
      if (updated) callbacks.onCardUpdated(updated);
      removeFromActive(boardId, cardId);
      fillSlots(db, boardId, callbacks);
    } else if (result.rateLimitInfo?.isRateLimit) {
      removeFromActive(boardId, cardId);
      handleRateLimited(db, boardId, card, result.rateLimitInfo, callbacks);
    } else {
      // Retry once
      const retryComments = commentsDb.listComments(db, cardId);
      const retryResult = await runCard(db, card, board, retryComments, config, callbacks);

      // Check again after retry — card may have been stopped during retry
      if (consumeStoppedFlag(cardId)) {
        log.info("queue", `Card ${cardId} was stopped during retry — skipping post-execution handling`);
        removeFromActive(boardId, cardId);
        fillSlots(db, boardId, callbacks);
        return;
      }

      if (retryResult.success) {
        cardsDb.updateCardStatus(db, cardId, "done");
        enforceAttachmentCap(db, card.board_id as BoardId);
        walCheckpoint(db);
        const updated = cardsDb.getCard(db, cardId);
        if (updated) callbacks.onCardUpdated(updated);
        removeFromActive(boardId, cardId);
        fillSlots(db, boardId, callbacks);
      } else if (retryResult.rateLimitInfo?.isRateLimit) {
        removeFromActive(boardId, cardId);
        handleRateLimited(db, boardId, card, retryResult.rateLimitInfo, callbacks);
      } else {
        // Failed after retry
        cardsDb.updateCardStatus(db, cardId, "failed");
        walCheckpoint(db);
        const updated = cardsDb.getCard(db, cardId);
        if (updated) callbacks.onCardUpdated(updated);
        removeFromActive(boardId, cardId);

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
            queueState.active = [];
            queueState.current = null;
          }

          callbacks.onQueueStopped(
            boardId,
            `Card "${cardLabel(card)}" failed after retry (blocking)`
          );
        } else {
          fillSlots(db, boardId, callbacks);
        }
      }
    }
  } catch (err) {
    log.error("queue", `Unexpected error processing card ${cardId}:`, err);
    // Don't override status if card was explicitly stopped
    if (!consumeStoppedFlag(cardId)) {
      cardsDb.updateCardStatus(db, cardId, "failed");
      const updated = cardsDb.getCard(db, cardId);
      if (updated) callbacks.onCardUpdated(updated);
    }
    removeFromActive(boardId, cardId);
    fillSlots(db, boardId, callbacks);
  }
}

/** Remove a card from the active set */
function removeFromActive(boardId: string, cardId: string): void {
  const state = queues.get(boardId);
  if (!state) return;
  state.active = state.active.filter((id) => id !== cardId);
  syncCurrent(state);
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
    callbacks.onQueueUpdated(boardId, state.queue, null, true, [...state.active]);
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

/** Notify the queue that a new card was added — fills open slots or auto-starts if idle */
export function notifyNewCard(
  db: Database,
  boardId: string,
  callbacks: QueueCallbacks
): void {
  const state = queues.get(boardId);
  if (state?.isPaused) return;
  if (state?.isRunning) {
    fillSlots(db, boardId, callbacks);
    return;
  }
  // No queue running — auto-start so queued cards are picked up immediately
  void startQueue(db, boardId as BoardId, callbacks);
}

/** Re-check concurrency after config changes and fill any new slots */
export function refreshConcurrency(
  db: Database,
  boardId: string,
  callbacks: QueueCallbacks
): void {
  const state = queues.get(boardId);
  if (!state || !state.isRunning || state.isPaused) return;
  fillSlots(db, boardId, callbacks);
}

/** Fill empty concurrency slots with cards from the queue */
function fillSlots(
  db: Database,
  boardId: string,
  callbacks: QueueCallbacks
): void {
  const state = queues.get(boardId);
  if (!state || !state.isRunning) return;

  // If paused, hold here — resumeQueue will call fillSlots again
  if (state.isPaused) {
    syncCurrent(state);
    queues.set(boardId, state);
    broadcastQueueState(state, callbacks);
    return;
  }

  try {
    const config = getMergedConfig(db, boardId as BoardId);
    const maxConcurrent = Math.min(Math.max(config.maxConcurrentCards ?? 1, 1), 3);
    const slotsAvailable = maxConcurrent - state.active.length;

    if (slotsAvailable <= 0 && state.active.length > 0) {
      // All slots full, still running
      syncCurrent(state);
      broadcastQueueState(state, callbacks);
      return;
    }

    if (state.queue.length === 0) {
      // Re-check DB for newly queued or in-progress cards (added while queue was running)
      const newQueued = cardsDb.listCardsByStatus(db, boardId as BoardId, "queued").filter((c) => c.assignee !== "human");
      const newInProgress = cardsDb.listCardsByStatus(db, boardId as BoardId, "in-progress").filter((c) => c.assignee !== "human" && !state.active.includes(c.id));
      const allNew = [...newInProgress, ...newQueued];
      if (allNew.length > 0) {
        state.queue = allNew.map((c) => c.id);
      } else if (state.active.length === 0) {
        queues.delete(boardId);
        callbacks.onQueueStopped(boardId, "All cards completed");
        return;
      } else {
        // Slots available but no new cards — keep running, wait for active cards
        syncCurrent(state);
        broadcastQueueState(state, callbacks);
        return;
      }
    }

    // Fill available slots
    const toStart: string[] = [];
    while (state.active.length + toStart.length < maxConcurrent && state.queue.length > 0) {
      const nextId = state.queue.shift()!;
      toStart.push(nextId);
    }

    state.active.push(...toStart);
    syncCurrent(state);
    queues.set(boardId, state);
    broadcastQueueState(state, callbacks);

    // Launch each new card concurrently
    for (const cardId of toStart) {
      void processCard(db, boardId, cardId as CardId, callbacks);
    }

    // If nothing was started and no active cards, queue is done
    if (toStart.length === 0 && state.active.length === 0) {
      queues.delete(boardId);
      callbacks.onQueueStopped(boardId, "All cards completed");
    }
  } catch (err) {
    log.error("queue", `fillSlots error for board ${boardId}, stopping queue:`, err);
    state.isRunning = false;
    state.queue = [];
    state.active = [];
    state.current = null;
    queues.set(boardId, state);
    callbacks.onQueueStopped(boardId, "Queue stopped due to internal error");
  }
}

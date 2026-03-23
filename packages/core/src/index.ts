// Logger
export { log } from "./logger.js";

// Schemas
export * from "./schemas/board.js";
export * from "./schemas/card.js";
export * from "./schemas/comment.js";
export * from "./schemas/execution.js";
export * from "./schemas/config.js";
export * from "./schemas/commit.js";
export * from "./schemas/ws-events.js";
export * from "./schemas/claude.js";

// Utils
export { cardLabel } from "./utils/cardLabel.js";
export { cleanupCardAttachments } from "./utils/attachments.js";

// Types
export type * from "./types/index.js";

// Database
export { getDb, getTestDb, closeDb, getDataDir } from "./db/connection.js";
export * as boardsDb from "./db/boards.js";
export * as cardsDb from "./db/cards.js";
export * as commentsDb from "./db/comments.js";
export * as executionsDb from "./db/executions.js";
export * as commitsDb from "./db/commits.js";

// Config
export * from "./config/manager.js";

// Executor
export { startQueue, executeSingleCard, stopCard, stopQueue, pauseQueue, resumeQueue, getQueueState } from "./executor/queue.js";
export type { QueueState, QueueCallbacks } from "./executor/queue.js";
export { killAllCardProcesses } from "./executor/runner.js";
export type { RunnerCallbacks, RunResult } from "./executor/runner.js";
export { buildPrompt } from "./executor/prompt.js";
export { parseStreamLine } from "./executor/stream-parser.js";
export { buildCliCommand } from "./executor/cli-adapter.js";
export type { CliCommand } from "./executor/cli-adapter.js";
export { killProcessTreeSync } from "./executor/process-cleanup.js";
export { detectRateLimit } from "./executor/rate-limit.js";
export type { RateLimitInfo } from "./executor/rate-limit.js";
export { runChat, killChatProcess, hasChatProcess, killAllChatProcesses } from "./executor/chat.js";
export type { ChatCallbacks, ChatOptions } from "./executor/chat.js";

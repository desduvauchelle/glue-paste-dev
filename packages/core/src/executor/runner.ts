import type { Database } from "bun:sqlite";
import type { Board, CardWithTags, ConfigInput, CardId, Comment, ExecutionId, FileChange } from "../types/index.js";
import * as executionsDb from "../db/executions.js";
import * as commentsDb from "../db/comments.js";
import * as cardsDb from "../db/cards.js";
import { buildPrompt } from "./prompt.js";
import { parseStreamLine } from "./stream-parser.js";
import { buildCliCommand } from "./cli-adapter.js";
import { detectRateLimit } from "./rate-limit.js";
import { detectGitError } from "./git-errors.js";
import { killProcessTreeSync } from "./process-cleanup.js";
import { getFreshEnv } from "./fresh-env.js";
import { log } from "../logger.js";
import { cardLabel } from "../utils/cardLabel.js";

/** Track active processes by cardId so they can be killed */
const activeCardProcesses = new Map<string, { proc: ReturnType<typeof Bun.spawn>; executionId: string }>();

export function getActiveCardProcess(cardId: string) {
  return activeCardProcesses.get(cardId);
}

export function killCardProcess(cardId: string): boolean {
  const entry = activeCardProcesses.get(cardId);
  if (!entry) return false;
  try {
    killProcessTreeSync(entry.proc.pid);
  } catch {
    // process may have already exited
  }
  activeCardProcesses.delete(cardId);
  return true;
}

export function killAllCardProcesses(): void {
  for (const [cardId, entry] of activeCardProcesses) {
    try {
      killProcessTreeSync(entry.proc.pid);
    } catch {
      // process may have already exited
    }
    activeCardProcesses.delete(cardId);
  }
}

export interface RunnerCallbacks {
  onExecutionStarted: (cardId: string, executionId: string, phase: "plan" | "execute") => void;
  onOutput: (executionId: string, chunk: string) => void;
  onExecutionCompleted: (executionId: string, status: "success" | "failed", exitCode: number, errorSummary?: string) => void;
  onCardUpdated: (card: CardWithTags) => void;
  onCommentAdded: (comment: Comment) => void;
}

export interface RunResult {
  success: boolean;
  exitCode: number;
  output: string;
  rateLimitInfo?: import("./rate-limit.js").RateLimitInfo;
}

/**
 * Runs a single card through the 2-phase plan+execute cycle.
 * Returns success/failure for queue logic.
 */
export async function runCard(
  db: Database,
  card: CardWithTags,
  board: Board,
  comments: Comment[],
  config: Required<ConfigInput>,
  callbacks: RunnerCallbacks,
  options?: { existingPlanOutput?: string }
): Promise<RunResult> {
  log.info("runner", `Running card "${cardLabel(card)}" (${card.id}) on board "${board.name}"`);
  log.debug("runner", `Starting execution for card ${card.id}`);
  cardsDb.updateCardStatus(db, card.id as CardId, "in-progress");
  const inProgressCard = cardsDb.getCard(db, card.id as CardId);
  if (inProgressCard) callbacks.onCardUpdated(inProgressCard);

  const THINKING_LEVEL_MODELS: Record<string, string> = {
    smart: "claude-opus-4-6",
    basic: "claude-sonnet-4-6",
  };

  /** Resolve model for a phase: explicit config model > thinking-level default > fallback */
  const resolveModel = (phase: "plan" | "execute", thinkingLevel: string): string => {
    const configModel = phase === "plan" ? config.planModel : config.executeModel;
    if (configModel) return configModel;
    return THINKING_LEVEL_MODELS[thinkingLevel] ?? config.model ?? "claude-opus-4-6";
  };

  // Use a single session for both plan and execute phases so execute inherits plan context
  const sessionId = crypto.randomUUID();

  let result: RunResult;
  const hasPlan = config.planThinking !== null;

  if (hasPlan) {
    const existingPlan = options?.existingPlanOutput;

    if (existingPlan) {
      // Reuse existing plan output (recovered after crash)
      log.info("runner", `Reusing existing plan output for card ${card.id}`);
    } else {
      // Phase 1: Plan
      const planConfig = { ...config, model: resolveModel("plan", config.planThinking!) };
      result = await executePhase(db, card, board, comments, planConfig, "plan", callbacks, sessionId, false);
      if (!result.success) {
        return result;
      }
    }

    // Phase 2: Execute (with plan context) — resume the session from plan phase
    const planOutput = existingPlan ?? result!.output;
    const execConfig = { ...config, model: resolveModel("execute", config.executeThinking ?? "smart") };
    result = await executePhase(db, card, board, comments, execConfig, "execute", callbacks, sessionId, true, planOutput);
  } else {
    // Single phase: just execute directly
    const execConfig = { ...config, model: resolveModel("execute", config.executeThinking ?? "smart") };
    result = await executePhase(db, card, board, comments, execConfig, "execute", callbacks, sessionId, false);
  }

  return result;
}

async function captureGitSha(directory: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", "rev-parse", "HEAD"], {
      cwd: directory,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) return null;
    return output.trim() || null;
  } catch {
    return null;
  }
}

async function captureFileChanges(directory: string, shaBefore: string): Promise<FileChange[]> {
  try {
    // Capture both committed and uncommitted changes relative to pre-execution state
    const proc = Bun.spawn(["git", "diff", "--numstat", shaBefore], {
      cwd: directory,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) return [];

    const files: FileChange[] = [];
    for (const line of output.trim().split("\n")) {
      if (!line.trim()) continue;
      const parts = line.split("\t");
      if (parts.length < 3) continue;
      const [addStr, delStr, ...pathParts] = parts;
      const path = pathParts.join("\t");
      // Binary files show "-" for additions/deletions
      const additions = addStr === "-" ? 0 : parseInt(addStr!, 10) || 0;
      const deletions = delStr === "-" ? 0 : parseInt(delStr!, 10) || 0;
      files.push({ path, additions, deletions });
    }
    return files;
  } catch {
    return [];
  }
}

async function executePhase(
  db: Database,
  card: CardWithTags,
  board: Board,
  comments: Comment[],
  config: Required<ConfigInput>,
  phase: "plan" | "execute",
  callbacks: RunnerCallbacks,
  sessionId: string,
  resume: boolean,
  planOutput?: string
): Promise<RunResult> {
  log.info("runner", `Phase "${phase}" starting for card "${cardLabel(card)}" (${card.id})`);
  log.debug("runner", `Phase "${phase}" using session ${sessionId}`);
  const prompt = buildPrompt({ card, board, comments, config, phase, planOutput });

  // Create execution record
  const execution = executionsDb.createExecution(
    db,
    card.id as CardId,
    sessionId,
    phase
  );

  callbacks.onExecutionStarted(card.id, execution.id, phase);

  // Add lifecycle comment: phase started
  const phaseStartedAt = Date.now();
  const phaseName = phase === "plan" ? "Plan" : "Execution";
  const startedComment = commentsDb.addSystemComment(
    db,
    card.id as CardId,
    execution.id,
    `${phaseName} started.`
  );
  callbacks.onCommentAdded(startedComment);

  // Capture git SHA before execution for file change tracking
  let shaBefore: string | null = null;
  if (phase === "execute") {
    shaBefore = await captureGitSha(board.directory);
    if (shaBefore) {
      log.debug("runner", `Captured pre-execution git SHA: ${shaBefore}`);
    }
  }

  // Build CLI command using the configured provider
  const cliCmd = buildCliCommand(config, prompt, sessionId, phase, resume);
  const args = cliCmd.args;

  log.info("runner", `Using CLI provider: ${config.cliProvider}`);
  log.debug("runner", `Spawning: ${args.join(" ")}`);
  const proc = Bun.spawn(args, {
    cwd: board.directory,
    stdout: "pipe",
    stderr: "pipe",
    env: await getFreshEnv(),
  });

  // Store PID for terminal attach
  if (proc.pid) {
    executionsDb.updateExecutionPid(db, execution.id, proc.pid);
  }

  // Track process for stop functionality
  activeCardProcesses.set(card.id, { proc, executionId: execution.id });

  // Stream stdout
  let output = "";
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Keep incomplete last line in buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (cliCmd.supportsStreamJson) {
          const parsed = parseStreamLine(line);
          if (parsed && (parsed.type === "text" || parsed.type === "tool_use")) {
            output += parsed.content + "\n";
            callbacks.onOutput(execution.id, parsed.content);
            executionsDb.appendExecutionOutput(db, execution.id, parsed.content + "\n");
          }
          if (parsed?.type === "result" && parsed.costUsd !== undefined) {
            executionsDb.updateExecutionCost(db, execution.id, parsed.costUsd);
          }
        } else if (line.trim()) {
          output += line + "\n";
          callbacks.onOutput(execution.id, line);
          executionsDb.appendExecutionOutput(db, execution.id, line + "\n");
        }
      }
    }
  } catch (err) {
    log.warn("runner", `Stream read error (execution ${execution.id}):`, err);
  }

  // Read stderr
  let stderrOutput = "";
  try {
    const stderrReader = proc.stderr.getReader();
    const stderrDecoder = new TextDecoder();
    while (true) {
      const { done, value } = await stderrReader.read();
      if (done) break;
      stderrOutput += stderrDecoder.decode(value, { stream: true });
    }
  } catch (err) {
    log.warn("runner", `stderr read error (execution ${execution.id}):`, err);
  }

  // Process remaining buffer
  if (buffer.trim()) {
    if (cliCmd.supportsStreamJson) {
      const parsed = parseStreamLine(buffer);
      if (parsed && (parsed.type === "text" || parsed.type === "tool_use")) {
        output += parsed.content + "\n";
        callbacks.onOutput(execution.id, parsed.content);
      }
    } else {
      output += buffer + "\n";
      callbacks.onOutput(execution.id, buffer);
    }
  }

  const exitCode = await proc.exited;
  activeCardProcesses.delete(card.id);
  const success = exitCode === 0;
  const status = success ? "success" : "failed";
  log.info("runner", `Phase "${phase}" ${status} for card ${card.id} (exit ${exitCode})`);
  if (!success && stderrOutput) {
    log.error("runner", `stderr:\n${stderrOutput.slice(-500)}`);
  }

  // Update execution record
  executionsDb.updateExecutionStatus(db, execution.id, status, exitCode);

  // Capture file changes after execute phase
  if (phase === "execute" && shaBefore) {
    try {
      const filesChanged = await captureFileChanges(board.directory, shaBefore);
      executionsDb.updateExecutionFilesChanged(db, execution.id as ExecutionId, filesChanged);
      log.info("runner", `Captured ${filesChanged.length} file changes for execution ${execution.id}`);
    } catch (err) {
      log.warn("runner", `Failed to capture file changes:`, err);
    }
  }

  // Add system comment with summary (including duration)
  const durationMs = Date.now() - phaseStartedAt;
  const durationStr = formatDuration(durationMs);
  let summary: string;
  if (success) {
    summary = `${phaseName} completed successfully in ${durationStr}.`;
  } else {
    summary = buildFailureSummary(phaseName, exitCode, output, stderrOutput, durationStr);
    const gitError = detectGitError(output, stderrOutput, exitCode);
    if (gitError) {
      summary += `\n\n**Git Error: ${gitError.message}**\n**How to fix:** ${gitError.suggestion}`;
    }
  }
  const comment = commentsDb.addSystemComment(db, card.id as CardId, execution.id, summary);
  callbacks.onCommentAdded(comment);

  const shortError = !success && stderrOutput
    ? stderrOutput.trim().split("\n").pop()?.slice(0, 100)
    : undefined;
  callbacks.onExecutionCompleted(execution.id, status, exitCode, shortError);

  const rateLimitResult = !success ? detectRateLimit(output, stderrOutput, exitCode) : null;

  return { success, exitCode, output, ...(rateLimitResult ? { rateLimitInfo: rateLimitResult } : {}) };
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function buildFailureSummary(
  phaseName: string,
  exitCode: number,
  output: string,
  stderr: string,
  durationStr?: string
): string {
  const tail = (text: string, maxLen: number) => {
    const trimmed = text.trim();
    if (!trimmed) return "";
    return trimmed.length > maxLen
      ? "..." + trimmed.slice(-maxLen)
      : trimmed;
  };

  let summary = `${phaseName} failed with exit code ${exitCode}${durationStr ? ` after ${durationStr}` : ""}.`;

  if (stderr) {
    summary += `\n\nstderr:\n${tail(stderr, 500)}`;
  }
  if (output) {
    summary += `\n\nLast output:\n${tail(output, 500)}`;
  }

  return summary;
}

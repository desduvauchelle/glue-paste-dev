import type { Database } from "bun:sqlite";
import type { Board, CardWithTags, ConfigInput, CardId, Comment } from "../types/index.js";
import * as executionsDb from "../db/executions.js";
import * as commentsDb from "../db/comments.js";
import * as cardsDb from "../db/cards.js";
import { buildPrompt } from "./prompt.js";
import { parseStreamLine } from "./stream-parser.js";
import { buildCliCommand } from "./cli-adapter.js";
import { log } from "../logger.js";

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
  callbacks: RunnerCallbacks
): Promise<RunResult> {
  log.info("runner", `Running card "${card.title}" (${card.id}) on board "${board.name}"`);
  log.debug("runner", `Starting execution for card ${card.id}`);
  cardsDb.updateCardStatus(db, card.id as CardId, "in-progress");
  const inProgressCard = cardsDb.getCard(db, card.id as CardId);
  if (inProgressCard) callbacks.onCardUpdated(inProgressCard);

  let result: RunResult;

  if (config.planMode) {
    // Phase 1: Plan
    result = await executePhase(db, card, board, comments, config, "plan", callbacks);
    if (!result.success) {
      return result;
    }

    // Phase 2: Execute
    result = await executePhase(db, card, board, comments, config, "execute", callbacks);
  } else {
    // Single phase: just execute directly
    result = await executePhase(db, card, board, comments, config, "execute", callbacks);
  }

  return result;
}

async function executePhase(
  db: Database,
  card: CardWithTags,
  board: Board,
  comments: Comment[],
  config: Required<ConfigInput>,
  phase: "plan" | "execute",
  callbacks: RunnerCallbacks
): Promise<RunResult> {
  log.info("runner", `Phase "${phase}" starting for card "${card.title}" (${card.id})`);
  const sessionId = crypto.randomUUID();
  log.debug("runner", `Phase "${phase}" using session ${sessionId}`);
  const prompt = buildPrompt({ card, board, comments, config, phase });

  // Create execution record
  const execution = executionsDb.createExecution(
    db,
    card.id as CardId,
    sessionId,
    phase
  );

  callbacks.onExecutionStarted(card.id, execution.id, phase);

  // Build CLI command using the configured provider
  const cliCmd = buildCliCommand(config, prompt, sessionId, phase);
  const args = cliCmd.args;

  log.info("runner", `Using CLI provider: ${config.cliProvider}`);
  log.debug("runner", `Spawning: ${args.join(" ")}`);
  const proc = Bun.spawn(args, {
    cwd: board.directory,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });

  // Store PID for terminal attach
  if (proc.pid) {
    executionsDb.updateExecutionPid(db, execution.id, proc.pid);
  }

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
  const success = exitCode === 0;
  const status = success ? "success" : "failed";
  log.info("runner", `Phase "${phase}" ${status} for card ${card.id} (exit ${exitCode})`);
  if (!success && stderrOutput) {
    log.error("runner", `stderr:\n${stderrOutput.slice(-500)}`);
  }

  // Update execution record
  executionsDb.updateExecutionStatus(db, execution.id, status, exitCode);

  // Add system comment with summary
  const phaseName = phase === "plan" ? "Plan" : "Execution";
  const summary = success
    ? `${phaseName} completed successfully.`
    : buildFailureSummary(phaseName, exitCode, output, stderrOutput);
  const comment = commentsDb.addSystemComment(db, card.id as CardId, execution.id, summary);
  callbacks.onCommentAdded(comment);

  const shortError = !success && stderrOutput
    ? stderrOutput.trim().split("\n").pop()?.slice(0, 100)
    : undefined;
  callbacks.onExecutionCompleted(execution.id, status, exitCode, shortError);

  return { success, exitCode, output };
}

function buildFailureSummary(
  phaseName: string,
  exitCode: number,
  output: string,
  stderr: string
): string {
  const tail = (text: string, maxLen: number) => {
    const trimmed = text.trim();
    if (!trimmed) return "";
    return trimmed.length > maxLen
      ? "..." + trimmed.slice(-maxLen)
      : trimmed;
  };

  let summary = `${phaseName} failed with exit code ${exitCode}.`;

  if (stderr) {
    summary += `\n\nstderr:\n${tail(stderr, 500)}`;
  }
  if (output) {
    summary += `\n\nLast output:\n${tail(output, 500)}`;
  }

  return summary;
}

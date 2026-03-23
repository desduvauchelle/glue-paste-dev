import type { Database } from "bun:sqlite";
import type { Board, CardWithTags, ConfigInput, CardId, Comment, ExecutionId, FileChange } from "../types/index.js";
import * as executionsDb from "../db/executions.js";
import * as commentsDb from "../db/comments.js";
import * as cardsDb from "../db/cards.js";
import * as commitsDb from "../db/commits.js";
import type { CreateCommitInput } from "../db/commits.js";
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
  log.info("runner", `=== Running card "${cardLabel(card)}" (${card.id}) on board "${board.name}" ===`);
  log.info("runner", `Card: title="${card.title}" status=${card.status} assignee=${card.assignee} tags=[${card.tags.join(",")}]`);
  log.info("runner", `Board directory: ${board.directory}`);
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

  // Handle branch checkout if configured
  if (config.branchMode === "new" || config.branchMode === "specific") {
    const targetBranch = config.branchMode === "new"
      ? `glue-paste/${card.id}-${Date.now()}`
      : config.branchName;

    if (targetBranch) {
      try {
        if (config.branchMode === "new") {
          const proc = Bun.spawn(["git", "checkout", "-b", targetBranch], {
            cwd: board.directory,
            stdout: "pipe",
            stderr: "pipe",
          });
          await proc.exited;
        } else {
          // Try to checkout existing branch, create if it doesn't exist
          const checkProc = Bun.spawn(["git", "checkout", targetBranch], {
            cwd: board.directory,
            stdout: "pipe",
            stderr: "pipe",
          });
          const checkExit = await checkProc.exited;
          if (checkExit !== 0) {
            const createProc = Bun.spawn(["git", "checkout", "-b", targetBranch], {
              cwd: board.directory,
              stdout: "pipe",
              stderr: "pipe",
            });
            await createProc.exited;
          }
        }
        log.info("runner", `Checked out branch: ${targetBranch}`);
      } catch (err) {
        log.warn("runner", `Failed to checkout branch ${targetBranch}:`, err);
      }
    }
  }

  // Use a single session for both plan and execute phases so execute inherits plan context
  const sessionId = crypto.randomUUID();

  let result: RunResult;
  const hasPlan = config.planThinking !== null;
  log.info("runner", `Execution strategy: hasPlan=${hasPlan} planThinking=${config.planThinking} executeThinking=${config.executeThinking}`);

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
    // Release plan output reference — no longer needed after execute phase
    result = { ...result, output: result.output.slice(-1024) };
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
    const stderrText = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      log.warn("runner", `captureGitSha failed (exit ${exitCode}) in ${directory}`, stderrText.trim());
      return null;
    }
    const sha = output.trim() || null;
    log.debug("runner", `captureGitSha: ${sha} in ${directory}`);
    return sha;
  } catch (err) {
    log.warn("runner", `captureGitSha threw in ${directory}:`, err);
    return null;
  }
}

async function captureFileChanges(directory: string, shaBefore: string): Promise<FileChange[]> {
  try {
    // Capture both committed and uncommitted changes relative to pre-execution state
    log.debug("runner", `captureFileChanges: git diff --numstat ${shaBefore} in ${directory}`);
    const proc = Bun.spawn(["git", "diff", "--numstat", shaBefore], {
      cwd: directory,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    const stderrText = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      log.warn("runner", `captureFileChanges git diff failed (exit ${exitCode}):`, stderrText.trim());
      return [];
    }

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
    log.debug("runner", `captureFileChanges: ${files.length} files changed`, files.map(f => f.path));
    return files;
  } catch (err) {
    log.warn("runner", `captureFileChanges threw:`, err);
    return [];
  }
}

async function captureNewCommits(directory: string, shaBefore: string): Promise<CreateCommitInput[]> {
  try {
    // Get commits made between shaBefore and HEAD
    const proc = Bun.spawn(
      ["git", "log", `${shaBefore}..HEAD`, "--format=%H%n%s%n%an%n%ae%n---END---", "--reverse"],
      { cwd: directory, stdout: "pipe", stderr: "pipe" }
    );
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0 || !output.trim()) return [];

    const commits: CreateCommitInput[] = [];
    const entries = output.trim().split("---END---\n");
    for (const entry of entries) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const lines = trimmed.split("\n");
      if (lines.length < 4) continue;
      const sha = lines[0]!;
      const message = lines[1]!;
      const authorName = lines[2]!;
      const authorEmail = lines[3]!;

      // Get per-commit file changes
      const diffProc = Bun.spawn(
        ["git", "diff", "--numstat", `${sha}~1`, sha],
        { cwd: directory, stdout: "pipe", stderr: "pipe" }
      );
      const diffOutput = await new Response(diffProc.stdout).text();
      await diffProc.exited;

      const filesChanged: FileChange[] = [];
      for (const line of diffOutput.trim().split("\n")) {
        if (!line.trim()) continue;
        const parts = line.split("\t");
        if (parts.length < 3) continue;
        const [addStr, delStr, ...pathParts] = parts;
        const path = pathParts.join("\t");
        const additions = addStr === "-" ? 0 : parseInt(addStr!, 10) || 0;
        const deletions = delStr === "-" ? 0 : parseInt(delStr!, 10) || 0;
        filesChanged.push({ path, additions, deletions });
      }

      commits.push({ sha, message, authorName, authorEmail, filesChanged });
    }

    log.info("runner", `captureNewCommits: found ${commits.length} new commits since ${shaBefore}`);
    return commits;
  } catch (err) {
    log.warn("runner", `captureNewCommits threw:`, err);
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
  log.info("runner", `Config: provider=${config.cliProvider} model=${config.model} autoCommit=${config.autoCommit} autoPush=${config.autoPush}`);
  log.debug("runner", `Phase "${phase}" using session ${sessionId}, resume=${resume}`);
  log.debug("runner", `Board directory: ${board.directory}`);
  const prompt = buildPrompt({ card, board, comments, config, phase, planOutput });
  log.debug("runner", `Prompt length: ${prompt.length} chars`);

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
      log.info("runner", `Pre-execution git SHA: ${shaBefore}`);
    } else {
      log.warn("runner", `Could not capture pre-execution git SHA — no-changes detection will be skipped`);
    }
  }

  // Build CLI command using the configured provider
  const cliCmd = buildCliCommand(config, prompt, sessionId, phase, resume);
  const args = cliCmd.args;

  log.info("runner", `Spawning CLI: ${args[0]} ${args.slice(1).map(a => a.length > 100 ? a.slice(0, 100) + '…' : a).join(" ")}`);
  log.debug("runner", `Full CLI args (${args.length}):`, args.map((a, i) => `[${i}] ${a.length > 200 ? a.slice(0, 200) + '…(' + a.length + ' chars)' : a}`));
  const proc = Bun.spawn(args, {
    cwd: board.directory,
    stdout: "pipe",
    stderr: "pipe",
    env: getFreshEnv(),
  });

  // Store PID for terminal attach
  if (proc.pid) {
    executionsDb.updateExecutionPid(db, execution.id, proc.pid);
  }

  // Track process for stop functionality
  activeCardProcesses.set(card.id, { proc, executionId: execution.id });

  // Stream stdout — only keep tail in memory (full output goes to DB)
  const MAX_OUTPUT_MEMORY = 50 * 1024; // 50KB
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
        // Cap in-memory output to tail only (full output is in DB)
        if (output.length > MAX_OUTPUT_MEMORY * 1.5) {
          output = output.slice(-MAX_OUTPUT_MEMORY);
        }
      }
    }
  } catch (err) {
    log.warn("runner", `Stream read error (execution ${execution.id}):`, err);
  }

  // Read stderr — only keep tail (last 2KB) since only the end is used for summaries
  const MAX_STDERR = 2048;
  let stderrOutput = "";
  try {
    const stderrReader = proc.stderr.getReader();
    const stderrDecoder = new TextDecoder();
    while (true) {
      const { done, value } = await stderrReader.read();
      if (done) break;
      stderrOutput += stderrDecoder.decode(value, { stream: true });
      if (stderrOutput.length > MAX_STDERR * 1.5) {
        stderrOutput = stderrOutput.slice(-MAX_STDERR);
      }
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
  let success = exitCode === 0;
  let status: "success" | "failed" = success ? "success" : "failed";
  log.info("runner", `Phase "${phase}" exited with code ${exitCode} for card ${card.id} — initial status: ${status}`);
  log.info("runner", `Output length: ${output.length} chars, stderr length: ${stderrOutput.length} chars`);
  if (stderrOutput) {
    log.info("runner", `stderr (last 500 chars):\n${stderrOutput.slice(-500)}`);
  }
  if (!success) {
    log.info("runner", `Output tail (last 300 chars):\n${output.slice(-300)}`);
  }

  // Update execution record
  executionsDb.updateExecutionStatus(db, execution.id, status, exitCode);

  // Capture file changes after execute phase
  let noChangesDetected = false;
  if (phase === "execute" && shaBefore) {
    try {
      const filesChanged = await captureFileChanges(board.directory, shaBefore);
      executionsDb.updateExecutionFilesChanged(db, execution.id as ExecutionId, filesChanged);
      log.info("runner", `File changes: ${filesChanged.length} files modified for execution ${execution.id}`);
      if (filesChanged.length > 0) {
        log.info("runner", `Changed files: ${filesChanged.map(f => `${f.path} (+${f.additions}/-${f.deletions})`).join(", ")}`);
      }

      // Detect when AI exited 0 but made no changes
      let shaAfter: string | null = null;
      if (success && filesChanged.length === 0) {
        log.info("runner", `No file changes detected after exit 0 — checking git SHA to confirm`);
        shaAfter = await captureGitSha(board.directory);
        log.info("runner", `Post-execution git SHA: ${shaAfter} (pre: ${shaBefore}, match: ${shaAfter === shaBefore})`);
      }

      noChangesDetected = shouldFailNoChanges({
        phase, exitCode, filesChanged, shaBefore, shaAfter,
      });

      if (noChangesDetected) {
        success = false;
        status = "failed";
        executionsDb.updateExecutionStatus(db, execution.id, "failed", exitCode);
        log.warn("runner", `Card ${card.id} exited 0 but produced no file changes — overriding to failed`);
        log.warn("runner", `AI output tail (last 500 chars):\n${output.slice(-500)}`);
      }
    } catch (err) {
      log.warn("runner", `Failed to capture file changes:`, err);
    }
  } else if (phase === "execute" && !shaBefore) {
    log.warn("runner", `Skipping no-changes detection: shaBefore is null (git SHA capture failed)`);
  }

  // Capture commits made during execute phase
  if (phase === "execute" && shaBefore) {
    try {
      const newCommits = await captureNewCommits(board.directory, shaBefore);
      if (newCommits.length > 0) {
        commitsDb.addCommits(db, card.id as CardId, execution.id as ExecutionId, newCommits);
        log.info("runner", `Stored ${newCommits.length} commits for card ${card.id}`);
      }
    } catch (err) {
      log.warn("runner", `Failed to capture commits:`, err);
    }
  }

  // Add system comment with summary (including duration)
  const durationMs = Date.now() - phaseStartedAt;
  const durationStr = formatDuration(durationMs);
  const summary = buildExecutionSummary({
    phaseName, durationStr, success, noChangesDetected, exitCode, output, stderrOutput,
  });
  const comment = commentsDb.addSystemComment(db, card.id as CardId, execution.id, summary);
  callbacks.onCommentAdded(comment);

  const shortError = !success && stderrOutput
    ? stderrOutput.trim().split("\n").pop()?.slice(0, 100)
    : undefined;
  callbacks.onExecutionCompleted(execution.id, status, exitCode, shortError);

  const rateLimitResult = !success ? detectRateLimit(output, stderrOutput, exitCode) : null;

  log.info("runner", `Phase "${phase}" final result for card ${card.id}: success=${success} exitCode=${exitCode} noChangesDetected=${noChangesDetected} rateLimit=${rateLimitResult?.isRateLimit ?? false}`);
  return { success, exitCode, output, ...(rateLimitResult ? { rateLimitInfo: rateLimitResult } : {}) };
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Determines whether an execute-phase result should be overridden to "failed"
 * because the AI exited 0 but produced no file changes.
 */
export function shouldFailNoChanges(params: {
  phase: "plan" | "execute";
  exitCode: number;
  filesChanged: FileChange[];
  shaBefore: string | null;
  shaAfter: string | null;
}): boolean {
  const { phase, exitCode, filesChanged, shaBefore, shaAfter } = params;
  if (phase !== "execute") return false;
  if (exitCode !== 0) return false;
  if (!shaBefore) return false;
  if (filesChanged.length > 0) return false;
  return shaAfter === shaBefore;
}

/**
 * Builds the summary comment for a completed execution phase.
 */
export function buildExecutionSummary(params: {
  phaseName: string;
  durationStr: string;
  success: boolean;
  noChangesDetected: boolean;
  exitCode: number;
  output: string;
  stderrOutput: string;
}): string {
  const { phaseName, durationStr, success, noChangesDetected, exitCode, output, stderrOutput } = params;

  if (noChangesDetected) {
    return `${phaseName} produced no file changes in ${durationStr} — marked as failed. The AI exited successfully but did not modify any files.`;
  }
  if (success) {
    return `${phaseName} completed successfully in ${durationStr}.`;
  }

  let summary = buildFailureSummary(phaseName, exitCode, output, stderrOutput, durationStr);
  const gitError = detectGitError(output, stderrOutput, exitCode);
  if (gitError) {
    summary += `\n\n**Git Error: ${gitError.message}**\n**How to fix:** ${gitError.suggestion}`;
  }
  return summary;
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

import type { Database } from "bun:sqlite";
import { readdirSync } from "fs";
import { join, resolve } from "path";
import * as cardsDb from "../db/cards.js";
import * as commentsDb from "../db/comments.js";
import * as criteriaDb from "../db/criteria.js";
import * as executionsDb from "../db/executions.js";
import { log } from "../logger.js";
import type { Board, CardId, CardWithTags, Comment, ConfigInput, CriterionId, ExecutionId, FileChange } from "../types/index.js";
import { extractExecuteReport, extractPlanReport, writeReportFile } from "./extract-report.js";
import { buildPrompt } from "./prompt.js";
import { captureFileChanges, captureGitSha, type RunnerCallbacks, type RunResult } from "./runner.js";
import type { TerminalHub } from "../terminal/index.js";

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/**
 * Runs a card's execution phase as a live interactive PTY session via the hub.
 * The hub session IS the run — the dashboard Terminal tab attaches to the same card.id session.
 * Phase 2: assumes the session does not already exist (open-already-exists edge deferred to Phase 3).
 */
export async function runCardInteractive(
  db: Database,
  card: CardWithTags,
  board: Board,
  comments: Comment[],
  config: Required<ConfigInput>,
  hub: TerminalHub,
  callbacks: RunnerCallbacks,
): Promise<RunResult> {
  // 1. Set card to in-progress
  cardsDb.updateCardStatus(db, card.id as CardId, "in-progress");
  const c = cardsDb.getCard(db, card.id as CardId);
  if (c) callbacks.onCardUpdated(c);

  // 2. Create execution record
  const sessionId = crypto.randomUUID();
  const execution = executionsDb.createExecution(db, card.id as CardId, sessionId, "execute");
  callbacks.onExecutionStarted(card.id, execution.id, "execute");

  // 3. Add lifecycle comment
  const startedComment = commentsDb.addSystemComment(db, card.id as CardId, execution.id, "Execution started.");
  callbacks.onCommentAdded(startedComment);

  // 4. Capture pre-run git SHA
  const shaBefore = await captureGitSha(board.directory);

  // 5. Resolve attachment paths
  let attachmentPaths: string[] = [];
  try {
    const attachDir = join(resolve(board.directory), ".glue-paste", "attachments", card.id);
    const names = readdirSync(attachDir);
    attachmentPaths = names.map((name) => `.glue-paste/attachments/${card.id}/${name}`);
  } catch { /* no attachments */ }

  // 6. Get criteria
  let criteria = criteriaDb.getCriteria(db, card.id as CardId);

  // 7. Build prompt
  const prompt = buildPrompt({ card, board, comments, config, phase: "execute", attachmentPaths, criteria });

  // 8. Open the live session and deliver the prompt as the run
  // Phase 2: if a session already exists for this card, that edge is deferred to Phase 3.
  hub.open(card.id, { cwd: board.directory, cols: 80, rows: 24, command: ["claude"], initialInput: prompt });

  // 9. Await the turn end
  const turnEnd = await hub.waitForTurnEnd(card.id);

  // 10. Capture transcript (ANSI-stripped tail)
  const transcript = hub.getScrollback(card.id).replace(ANSI, "").slice(-50_000);
  executionsDb.appendExecutionOutput(db, execution.id as ExecutionId, transcript);
  callbacks.onOutput(execution.id, transcript);

  if (turnEnd.reason === "idle") {
    // SUCCESS — session stays alive (do NOT close it)

    // Capture file changes
    let filesChanged: FileChange[] = [];
    if (shaBefore) {
      filesChanged = await captureFileChanges(board.directory, shaBefore);
      executionsDb.updateExecutionFilesChanged(db, execution.id as ExecutionId, filesChanged);
    }

    executionsDb.updateExecutionStatus(db, execution.id as ExecutionId, "success", 0);

    // Proof-of-work (best-effort, never fails the card — mirror runner.ts convention)
    try {
      if (criteria.length === 0) {
        const planReport = await extractPlanReport({ title: card.title, description: card.description, planOutput: transcript });
        if (planReport) {
          criteriaDb.seedCriteria(db, card.id as CardId, planReport.criteria);
          cardsDb.setPlanSummary(db, card.id as CardId, planReport.plan_summary);
          writeReportFile(board.directory, execution.id, planReport);
          criteria = criteriaDb.getCriteria(db, card.id as CardId);
        }
      }
      const execReport = await extractExecuteReport({ title: card.title, description: card.description, criteria, output: transcript, filesChanged, exitCode: 0 });
      if (execReport) {
        for (const r of execReport.criteria) {
          criteriaDb.setCriterionResult(db, r.id as CriterionId, r.status, r.evidence, execution.id as ExecutionId);
        }
        cardsDb.setCompletionSummary(db, card.id as CardId, execReport.completion_summary);
        cardsDb.setBlocker(db, card.id as CardId, null);
        writeReportFile(board.directory, execution.id, execReport);
        const passed = execReport.criteria.filter((r) => r.status === "pass").length;
        if (execReport.criteria.length > 0) {
          const proof = commentsDb.addSystemComment(db, card.id as CardId, execution.id, `Proof: ${passed}/${execReport.criteria.length} criteria passed.`);
          callbacks.onCommentAdded(proof);
        }
      }
      const refreshed = cardsDb.getCard(db, card.id as CardId);
      if (refreshed) callbacks.onCardUpdated(refreshed);
    } catch (err) {
      log.warn("pty-runner", `Proof extraction failed for card ${card.id}:`, err);
    }

    callbacks.onExecutionCompleted(execution.id, "success", 0);
    const done = commentsDb.addSystemComment(db, card.id as CardId, execution.id, "Turn complete — awaiting review.");
    callbacks.onCommentAdded(done);

    return { success: true, exitCode: 0, output: transcript.slice(-1024) };
  } else {
    // FAILURE — session already gone (exited before completing a turn)
    const code = turnEnd.code;

    executionsDb.updateExecutionStatus(db, execution.id as ExecutionId, "failed", code);

    // Proof-of-work for blocker (best-effort)
    try {
      const execReport = await extractExecuteReport({ title: card.title, description: card.description, criteria, output: transcript, filesChanged: [], exitCode: code });
      if (execReport) {
        for (const r of execReport.criteria) {
          criteriaDb.setCriterionResult(db, r.id as CriterionId, r.status, r.evidence, execution.id as ExecutionId);
        }
        cardsDb.setBlocker(db, card.id as CardId, execReport.blocker);
        writeReportFile(board.directory, execution.id, execReport);
      }
      const refreshed = cardsDb.getCard(db, card.id as CardId);
      if (refreshed) callbacks.onCardUpdated(refreshed);
    } catch (err) {
      log.warn("pty-runner", `Proof extraction failed (exit path) for card ${card.id}:`, err);
    }

    callbacks.onExecutionCompleted(execution.id, "failed", code);
    const failComment = commentsDb.addSystemComment(db, card.id as CardId, execution.id, `Session exited (code ${code}) before completing a turn.`);
    callbacks.onCommentAdded(failComment);

    return { success: false, exitCode: code, output: transcript.slice(-1024) };
  }
}

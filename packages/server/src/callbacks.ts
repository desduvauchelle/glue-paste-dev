import type { Database } from "bun:sqlite";
import { boardsDb, cardLabel } from "@glue-paste-dev/core";
import type { BoardId, QueueCallbacks } from "@glue-paste-dev/core";
import { checkAndToggleCaffeinate } from "./caffeinate.js";

export function makeCallbacks(db: Database, broadcast: (event: unknown) => void): QueueCallbacks {
  return {
    onExecutionStarted(cardId, executionId, phase) {
      checkAndToggleCaffeinate(db);
      broadcast({
        type: "execution:started",
        payload: { cardId, executionId, phase },
      });
    },
    onOutput(executionId, chunk) {
      broadcast({
        type: "execution:output",
        payload: { executionId, chunk },
      });
    },
    onExecutionCompleted(executionId, status, exitCode, errorSummary) {
      broadcast({
        type: "execution:completed",
        payload: { executionId, status, exitCode },
      });
    },
    onCommentAdded(comment) {
      broadcast({ type: "comment:added", payload: comment });
    },
    onQueueUpdated(boardId: string, queue: string[], current: string | null, isPaused: boolean, active?: string[]) {
      broadcast({
        type: "queue:updated",
        payload: { boardId, queue, current, isPaused, active: active ?? [] },
      });
    },
    onQueueStopped(boardId, reason) {
      checkAndToggleCaffeinate(db);
      broadcast({
        type: "queue:stopped",
        payload: { boardId, reason },
      });
      const board = boardsDb.getBoard(db, boardId as BoardId);
      const boardName = board?.name ?? "Unknown Board";
      broadcast({
        type: "notification",
        payload: {
          level: reason.includes("failed") ? "error" : "info",
          title: `Queue Stopped — ${boardName}`,
          message: reason,
        },
      });
    },
    onRateLimited(boardId: string, cardTitle: string, retryInSeconds: number, resetMessage?: string) {
      broadcast({
        type: "notification",
        payload: {
          level: "warning",
          title: "Rate Limited",
          message: `Rate limited on "${cardTitle}". Restarting in ${retryInSeconds}s.`,
        },
      });
    },
    onOverloaded(boardId: string, cardTitle: string, retryInSeconds: number) {
      broadcast({
        type: "notification",
        payload: {
          level: "warning",
          title: "Servers Overloaded",
          message: `Claude servers are overloaded. Retrying "${cardTitle}" in ${retryInSeconds}s.`,
        },
      });
    },
    onCardUpdated(card) {
      checkAndToggleCaffeinate(db);
      broadcast({
        type: "card:updated",
        payload: card,
      });
      const board = boardsDb.getBoard(db, card.board_id as BoardId);
      const boardName = board?.name ?? "Unknown Board";
      const label = cardLabel(card);
      const notifMap: Record<string, { level: string; title: string; message: string }> = {
        done: { level: "success", title: `Card Completed — ${boardName}`, message: `"${label}" completed successfully` },
        failed: { level: "error", title: `Card Failed — ${boardName}`, message: `"${label}" failed` },
      };
      const notif = notifMap[card.status as string];
      if (notif) {
        broadcast({ type: "notification", payload: notif });
      }
    },
  };
}

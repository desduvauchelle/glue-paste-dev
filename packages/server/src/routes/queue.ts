import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import {
  startQueue,
  executeSingleCard,
  stopCard,
  stopQueue,
  pauseQueue,
  resumeQueue,
  getQueueState,
} from "@glue-paste-dev/core";
import type { BoardId, CardId, QueueCallbacks } from "@glue-paste-dev/core";

function makeCallbacks(broadcast: (event: unknown) => void): QueueCallbacks {
  return {
    onExecutionStarted(cardId, executionId, phase) {
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
    onQueueUpdated(boardId, queue, current, isPaused) {
      broadcast({
        type: "queue:updated",
        payload: { boardId, queue, current, isPaused },
      });
    },
    onQueueStopped(boardId, reason) {
      broadcast({
        type: "queue:stopped",
        payload: { boardId, reason },
      });
      broadcast({
        type: "notification",
        payload: {
          level: reason.includes("failed") ? "error" : "info",
          title: "Queue Stopped",
          message: reason,
        },
      });
    },
    onRateLimited(boardId: string, cardTitle: string, resetMessage?: string) {
      broadcast({
        type: "notification",
        payload: {
          level: "warning",
          title: "Rate Limited",
          message: `CLI rate limited on "${cardTitle}". ${resetMessage ?? "Check provider dashboard for reset time."} Queue paused.`,
        },
      });
    },
    onCardUpdated(card) {
      broadcast({
        type: "card:updated",
        payload: card,
      });
      const notifMap: Record<string, { level: string; title: string; message: string }> = {
        done: { level: "success", title: "Card Completed", message: "Execution completed successfully" },
        failed: { level: "error", title: "Card Failed", message: "Execution failed" },
        "rate-limited": { level: "warning", title: "Card Rate Limited", message: "CLI provider rate limit hit" },
      };
      const notif = notifMap[card.status as string];
      if (notif) {
        broadcast({ type: "notification", payload: notif });
      }
    },
  };
}

export function queueRoutes(
  db: Database,
  broadcast: (event: unknown) => void
) {
  const app = new Hono();
  const callbacks = makeCallbacks(broadcast);

  // GET /api/queue/:boardId
  app.get("/:boardId", (c) => {
    const state = getQueueState(c.req.param("boardId"));
    return c.json(state);
  });

  // POST /api/queue/:boardId/play - start sequential execution
  app.post("/:boardId/play", async (c) => {
    const boardId = c.req.param("boardId") as BoardId;
    const state = getQueueState(boardId);
    if (state.isRunning) {
      return c.json({ error: "Queue already running" }, 409);
    }

    // Start queue in background (don't await - returns immediately)
    void startQueue(db, boardId, callbacks);

    return c.json({ ok: true, message: "Queue started" });
  });

  // POST /api/queue/:boardId/pause - pause queue
  app.post("/:boardId/pause", (c) => {
    const boardId = c.req.param("boardId");
    pauseQueue(boardId, callbacks);
    return c.json({ ok: true });
  });

  // POST /api/queue/:boardId/resume - resume paused queue
  app.post("/:boardId/resume", (c) => {
    const boardId = c.req.param("boardId") as BoardId;
    resumeQueue(db, boardId, callbacks);
    return c.json({ ok: true });
  });

  // DELETE /api/queue/:boardId/play - stop queue
  app.delete("/:boardId/play", (c) => {
    const boardId = c.req.param("boardId");
    stopQueue(boardId, callbacks);
    return c.json({ ok: true });
  });

  return app;
}

export function cardExecuteRoutes(
  db: Database,
  broadcast: (event: unknown) => void
) {
  const app = new Hono();
  const callbacks = makeCallbacks(broadcast);

  // POST /api/cards/:cardId/stop - stop a running card
  app.post("/:cardId/stop", (c) => {
    const cardId = c.req.param("cardId") as CardId;
    stopCard(db, cardId, callbacks);
    return c.json({ ok: true });
  });

  // POST /api/cards/:cardId/execute - execute single card
  app.post("/:cardId/execute", async (c) => {
    const cardId = c.req.param("cardId") as CardId;

    // Execute in background
    void executeSingleCard(db, cardId, callbacks);

    return c.json({ ok: true, message: "Execution started" });
  });

  return app;
}

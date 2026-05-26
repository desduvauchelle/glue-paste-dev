import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import {
  cardsDb,
  boardsDb,
  getGlobalConfig,
  clearAwaitingReview,
} from "@glue-paste-dev/core";
import type { CardId, BoardId, TerminalPermissionMode } from "@glue-paste-dev/core";
import { getTerminalHub } from "../terminal-hub-singleton.js";

export function terminalRoutes(db: Database, broadcast: (e: unknown) => void) {
  const app = new Hono();

  // Open (or no-op if already running) the live terminal for a card.
  app.post("/:id/terminal", async (c) => {
    const cardId = c.req.param("id") as CardId;
    const card = cardsDb.getCard(db, cardId);
    if (!card) return c.json({ error: "Card not found" }, 404);
    const board = boardsDb.getBoard(db, card.board_id as BoardId);
    if (!board) return c.json({ error: "Board not found" }, 404);

    const permissionMode = (getGlobalConfig(db).terminalPermissionMode ?? "auto-unless-watching") as TerminalPermissionMode;
    const hub = getTerminalHub(broadcast, permissionMode, db);
    const body = (await c.req.json().catch(() => ({}))) as { cols?: number; rows?: number };
    hub.open(cardId, { cwd: board.directory, cols: body.cols ?? 80, rows: body.rows ?? 24 });
    return c.json({ ok: true, running: hub.isRunning(cardId) });
  });

  // Replay scrollback + running flag (used by the client on (re)attach).
  app.get("/:id/terminal", (c) => {
    const cardId = c.req.param("id") as CardId;
    const permissionMode = (getGlobalConfig(db).terminalPermissionMode ?? "auto-unless-watching") as TerminalPermissionMode;
    const hub = getTerminalHub(broadcast, permissionMode, db);
    return c.json({ running: hub.isRunning(cardId), scrollback: hub.getScrollback(cardId) });
  });

  // Kill the session.
  app.delete("/:id/terminal", (c) => {
    const cardId = c.req.param("id") as CardId;
    const permissionMode = (getGlobalConfig(db).terminalPermissionMode ?? "auto-unless-watching") as TerminalPermissionMode;
    const hub = getTerminalHub(broadcast, permissionMode, db);
    hub.close(cardId);
    return c.json({ ok: true });
  });

  // Stop = interrupt the current turn (Ctrl-C). The session stays alive (unlike DELETE which kills).
  app.post("/:id/terminal/stop", (c) => {
    const cardId = c.req.param("id") as CardId;
    const permissionMode = (getGlobalConfig(db).terminalPermissionMode ?? "auto-unless-watching") as TerminalPermissionMode;
    const hub = getTerminalHub(broadcast, permissionMode, db);
    hub.interrupt(cardId);
    return c.json({ ok: true });
  });

  // Kill the interactive session and reset session_state (used by drag → Done/ToDo/Queued).
  app.post("/:id/session/kill", (c) => {
    const cardId = c.req.param("id") as CardId;
    const permissionMode = (getGlobalConfig(db).terminalPermissionMode ?? "auto-unless-watching") as TerminalPermissionMode;
    const hub = getTerminalHub(broadcast, permissionMode, db);
    hub.close(cardId);
    cardsDb.setSessionState(db, cardId, null);
    clearAwaitingReview(cardId);
    const card = cardsDb.getCard(db, cardId);
    if (card) broadcast({ type: "card:updated", payload: card });
    return c.json({ ok: true });
  });

  return app;
}

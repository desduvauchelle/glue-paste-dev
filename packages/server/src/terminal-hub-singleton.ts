import { createTerminalHub, cardsDb, type TerminalHub, type TerminalPermissionMode } from "@glue-paste-dev/core";
import type { CardId } from "@glue-paste-dev/core";
import type { Database } from "bun:sqlite";

let hub: TerminalHub | null = null;

/**
 * Returns the process-wide TerminalHub, creating it on first call.
 *
 * `permissionMode` is supplied by the caller (the route layer reads the
 * resolved global config via `getGlobalConfig(db).terminalPermissionMode`).
 * `broadcast` is the server's existing WS broadcaster; the hub uses it to push
 * `terminal:output` / `terminal:exit` / `execution:idle` / `card:updated` events to all connected clients.
 * `db` is captured in the closure at first creation — one process-wide db instance.
 */
export function getTerminalHub(
  broadcast: (event: unknown) => void,
  permissionMode: TerminalPermissionMode,
  db: Database
): TerminalHub {
  if (hub) return hub;
  hub = createTerminalHub({
    permissionMode,
    command: ["claude"],
    onOutput: (cardId, data) => broadcast({ type: "terminal:output", payload: { cardId, data } }),
    onExit: (cardId, code) => broadcast({ type: "terminal:exit", payload: { cardId, exitCode: code } }),
    onIdle: (cardId) => {
      cardsDb.setSessionState(db, cardId as CardId, "idle");
      broadcast({ type: "execution:idle", payload: { cardId } });
      const card = cardsDb.getCard(db, cardId as CardId);
      if (card) broadcast({ type: "card:updated", payload: card });
    },
    onBusy: (cardId) => {
      cardsDb.setSessionState(db, cardId as CardId, "working");
      const card = cardsDb.getCard(db, cardId as CardId);
      if (card) broadcast({ type: "card:updated", payload: card });
    },
    onPermissionPending: (cardId, pending) =>
      broadcast({ type: "permission:pending", payload: { cardId, pending } }),
    maxSessions: 12,
  });
  return hub;
}

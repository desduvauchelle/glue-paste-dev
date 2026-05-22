import { createTerminalHub, type TerminalHub, type TerminalPermissionMode } from "@glue-paste-dev/core";

let hub: TerminalHub | null = null;

/**
 * Returns the process-wide TerminalHub, creating it on first call.
 *
 * `permissionMode` is supplied by the caller (the route layer reads the
 * resolved global config via `getGlobalConfig(db).terminalPermissionMode`).
 * `broadcast` is the server's existing WS broadcaster; the hub uses it to push
 * `terminal:output` / `terminal:exit` events to all connected clients.
 */
export function getTerminalHub(
  broadcast: (event: unknown) => void,
  permissionMode: TerminalPermissionMode
): TerminalHub {
  if (hub) return hub;
  hub = createTerminalHub({
    permissionMode,
    command: ["claude"],
    onOutput: (cardId, data) => broadcast({ type: "terminal:output", payload: { cardId, data } }),
    onExit: (cardId, code) => broadcast({ type: "terminal:exit", payload: { cardId, exitCode: code } }),
  });
  return hub;
}

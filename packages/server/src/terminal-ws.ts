import { log, type TerminalHub } from "@glue-paste-dev/core";

/** Pure router: parses one inbound WS message and dispatches to the hub. */
export function handleTerminalMessage(hub: TerminalHub, clientId: string, raw: string): void {
  let msg: { type?: string; cardId?: string; data?: string; cols?: number; rows?: number };
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (!msg.type?.startsWith("terminal:") || !msg.cardId) return;
  switch (msg.type) {
    case "terminal:attach":
      hub.attach(clientId, msg.cardId);
      break;
    case "terminal:detach":
      hub.detach(clientId, msg.cardId);
      break;
    case "terminal:heartbeat":
      hub.heartbeat(clientId, msg.cardId);
      break;
    case "terminal:input":
      if (typeof msg.data === "string") hub.input(msg.cardId, msg.data);
      break;
    case "terminal:resize":
      if (typeof msg.cols === "number" && typeof msg.rows === "number") {
        hub.resize(msg.cardId, msg.cols, msg.rows);
      }
      break;
    default:
      log.debug("terminal-ws", `unknown terminal message ${msg.type}`);
  }
}

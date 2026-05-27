import type { IBackend } from "../backend";

function notImplemented(path: string): any {
  return new Proxy({}, {
    get(_t, prop) {
      if (typeof prop === "string") {
        return new Proxy(() => {}, {
          apply() {
            throw new Error(
              `ipc backend not implemented yet (Phase 4 wires it): called ${path}.${prop}`
            );
          },
        });
      }
      return undefined;
    },
  });
}

export const ipcBackend = {
  boards: notImplemented("boards"),
  cards: notImplemented("cards"),
  comments: notImplemented("comments"),
  executions: notImplemented("executions"),
  commits: notImplemented("commits"),
  criteria: notImplemented("criteria"),
  config: notImplemented("config"),
  queue: notImplemented("queue"),
  tags: notImplemented("tags"),
  stats: notImplemented("stats"),
  files: notImplemented("files"),
  attachments: notImplemented("attachments"),
  ai: notImplemented("ai"),
  chat: notImplemented("chat"),
  update: notImplemented("update"),
  caffeinate: notImplemented("caffeinate"),
  terminal: notImplemented("terminal"),
  ws: {
    sendWS: (): never => {
      throw new Error("ipc backend not implemented (Phase 4 wires it): ws.sendWS");
    },
    useWebSocket: (): never => {
      throw new Error("ipc backend not implemented (Phase 4 wires it): ws.useWebSocket");
    },
    useWSEvent: (): never => {
      throw new Error("ipc backend not implemented (Phase 4 wires it): ws.useWSEvent");
    },
  },
} as unknown as IBackend;

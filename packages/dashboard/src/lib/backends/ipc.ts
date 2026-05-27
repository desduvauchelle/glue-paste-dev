import type { IBackend } from "../backend";
import { invoke } from "@tauri-apps/api/core";

function notImplemented(path: string): any {
  return new Proxy({}, {
    get(_t, prop) {
      if (typeof prop === "string") {
        return new Proxy(() => {}, {
          apply() {
            throw new Error(
              `ipc backend not implemented yet (Phase 4.5): called ${path}.${prop}`
            );
          },
        });
      }
      return undefined;
    },
  });
}

export const ipcBackend = {
  boards: {
    list: () => invoke<any[]>("boards_list"),
    get: (id: string) => invoke<any | null>("boards_get", { id }),
    create: (input: any) => invoke<any>("boards_create", { input }),
    update: (id: string, input: any) => invoke<any | null>("boards_update", { id, input }),
    delete: (id: string) => invoke<{ ok: boolean }>("boards_delete", { id }).then((deleted) => ({ ok: deleted as unknown as boolean })),
  },
  cards: {
    list: (boardId: string, doneLimit = 20) =>
      invoke<{ cards: any[]; done_has_more: boolean }>("cards_list_for_board", { boardId, doneLimit })
        .then(({ cards, done_has_more }) => ({ cards, doneHasMore: done_has_more })),
    get: (id: string) => invoke<any>("cards_get_with_tags", { id }),
    create: (boardId: string, input: any) => invoke<any>("cards_create", { boardId, input }),
    update: (id: string, input: any) => invoke<any>("cards_update", { id, input }),
    move: (id: string, data: { status: string; position: number }) =>
      invoke<any>("cards_move", { id, status: data.status, position: data.position }),
    reorder: () => Promise.reject(new Error("ipc backend not implemented: cards.reorder (Phase 4.5)")),
    delete: (id: string) => invoke<boolean>("cards_delete", { id }).then((deleted) => ({ ok: deleted as unknown as boolean })),
    moveToBoard: () => Promise.reject(new Error("ipc backend not implemented: cards.moveToBoard (Phase 4.5)")),
    execute: () => Promise.reject(new Error("ipc backend not implemented: cards.execute (Phase 4.5)")),
    stop: () => Promise.reject(new Error("ipc backend not implemented: cards.stop (Phase 4.5)")),
  },
  comments: {
    list: (cardId: string) => invoke<any[]>("comments_list_for_card", { cardId }),
    create: (cardId: string, input: any) => invoke<any>("comments_create", { cardId, input }),
    clear: (cardId: string) => invoke<number>("comments_clear", { cardId }).then(() => ({ ok: true })),
  },
  executions: {
    list: (cardId: string) => invoke<any[]>("executions_list_for_card", { cardId }),
    get: () => Promise.reject(new Error("ipc backend not implemented: executions.get (Phase 4.5)")),
  },
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
      throw new Error("ipc backend not implemented (Phase 4.5): ws.sendWS");
    },
    useWebSocket: (): never => {
      throw new Error("ipc backend not implemented (Phase 4.5): ws.useWebSocket");
    },
    useWSEvent: (): never => {
      throw new Error("ipc backend not implemented (Phase 4.5): ws.useWSEvent");
    },
  },
} as unknown as IBackend;

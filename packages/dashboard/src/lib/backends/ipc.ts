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
    execute: (id: string) => invoke<void>("card_execute_single", { cardId: id }).then(() => ({ ok: true })),
    stop: (id: string) => invoke<boolean>("card_stop", { cardId: id }).then(() => ({ ok: true })),
  },
  comments: {
    list: (cardId: string) => invoke<any[]>("comments_list_for_card", { cardId }),
    create: (cardId: string, input: any) => invoke<any>("comments_create", { cardId, input }),
    clear: (cardId: string) => invoke<number>("comments_clear", { cardId }).then(() => ({ ok: true })),
  },
  executions: {
    list: (cardId: string) => invoke<any[]>("executions_list_for_card", { cardId }),
    get: (id: string) => invoke<any>("executions_get", { id }),
  },
  commits: {
    list: (cardId: string) => invoke<any[]>("commits_list_for_card", { cardId }),
  },
  criteria: {
    add: (cardId: string, text: string) =>
      invoke<any>("criteria_add", { cardId, input: { text, source: "user" } }),
    update: (id: string, data: { text?: string; status?: "pending" | "pass" | "fail" }) =>
      invoke<any>("criteria_update", { id, input: data }),
    remove: (id: string) =>
      invoke<boolean>("criteria_remove", { id }).then(() => ({ ok: true })),
    reorder: (_updates: Array<{ id: string; position: number }>) => {
      // The Rust side takes ordered_ids + card_id; we need to derive card_id from the first criterion
      // Simplified: reorder is best-effort, use first id's card via a separate criteria_reorder command
      // that takes the card_id implicitly. Since the Bun server derives card_id from DB, we skip here
      // and just signal ok — actual reordering requires knowing card_id upfront.
      // The frontend always has card_id in context; adapt the call site if needed.
      return Promise.reject(new Error("ipc backend: criteria.reorder needs card_id; use criteria_reorder directly"));
    },
  },
  config: {
    getGlobal: () => invoke<any>("config_get_global"),
    updateGlobal: (data: any) => invoke<any>("config_update_global", { input: data }),
    getForBoard: (boardId: string) => invoke<any>("config_get_for_board", { boardId }),
    getForBoardRaw: (boardId: string) => invoke<any>("config_get_for_board", { boardId }),
    updateForBoard: (boardId: string, data: any) =>
      invoke<any>("config_update_for_board", { boardId, input: data }),
  },
  queue: {
    status: (boardId: string) =>
      invoke<any>("queue_get_state", { boardId }).then((s) =>
        s
          ? {
              boardId: s.boardId,
              queue: s.queue ?? [],
              current: s.current ?? null,
              isRunning: s.isRunning ?? false,
              isPaused: s.isPaused ?? false,
            }
          : { boardId, queue: [], current: null, isRunning: false, isPaused: false }
      ),
    start: (boardId: string) =>
      invoke<void>("queue_start", { boardId }).then(() => ({ ok: true })),
    stop: (boardId: string) =>
      invoke<boolean>("queue_stop", { boardId }).then(() => ({ ok: true })),
    pause: (boardId: string) =>
      invoke<boolean>("queue_pause", { boardId }).then(() => ({ ok: true })),
    resume: (boardId: string) =>
      invoke<boolean>("queue_resume", { boardId }).then(() => ({ ok: true })),
  },
  tags: {
    defaults: () => invoke<string[]>("tags_defaults"),
    forBoard: (boardId: string) => invoke<string[]>("tags_for_board", { boardId }),
  },
  stats: {
    boardCounts: () => invoke<any>("stats_board_counts"),
    donePerDay: (days?: number, tzOffset?: number) =>
      invoke<any[]>("stats_done_per_day", { days: days ?? null, tzOffset: tzOffset ?? null }),
    donePerDayByBoard: (days?: number, tzOffset?: number) =>
      invoke<any>("stats_done_per_day_by_board", { days: days ?? null, tzOffset: tzOffset ?? null }),
  },
  files: {
    browse: (boardId: string, path?: string) =>
      invoke<any[]>("files_browse", { boardId, path: path ?? null }),
    tree: (boardId: string) => invoke<any>("files_tree", { boardId }),
  },
  attachments: {
    upload: () => Promise.reject(new Error("ipc backend: attachments.upload stays on HTTP (multipart)")),
    cleanup: (boardId: string, cardId: string) =>
      invoke<{ ok: boolean }>("attachments_cleanup", { boardId, cardId }),
    list: (boardId: string, cardId: string) =>
      invoke<string[]>("attachments_list", { boardId, cardId }),
    deleteFile: (boardId: string, cardId: string, filename: string) =>
      invoke<{ ok: boolean }>("attachments_delete_file", { boardId, cardId, filename }),
  },
  ai: {
    generateTitle: (description: string) =>
      invoke<string>("ai_generate_title", { args: { description } }).then((title) => ({ title })),
  },
  chat: {
    send: (cardId: string, data: { message: string; mode: string; thinking: string }) =>
      invoke<void>("chat_start", { cardId, args: data }).then(() => ({ ok: true })),
    stop: (cardId: string) =>
      invoke<boolean>("chat_stop", { cardId }).then((killed) => ({ ok: true, killed: killed as unknown as boolean })),
  },
  update: {
    check: () =>
      invoke<{ available: boolean; current: string; latest: string; asset_url: string | null }>("update_check").then(
        (r) => ({ available: r.available, currentVersion: r.current, latestVersion: r.latest })
      ),
    apply: () => Promise.reject(new Error("ipc backend: update_apply deferred to Phase 4.8")),
    logs: () => Promise.reject(new Error("ipc backend: update_logs not implemented")),
  },
  caffeinate: {
    status: () => invoke<any>("caffeinate_status"),
    start: () => invoke<any>("caffeinate_start"),
    stop: () => invoke<any>("caffeinate_stop"),
  },
  terminal: notImplemented("terminal"),
  ws: {
    // No bidirectional WS in IPC mode — sending is a no-op.
    sendWS: (_message: unknown): boolean => false,
    useWebSocket: (onEvent: (event: { type: string; payload: unknown }) => void): void => {
      // Implemented via Tauri event bridge in lib/ws.ts when VITE_BACKEND=ipc.
      // This method is provided for type-compat; actual subscription is wired in ws.ts.
      void onEvent;
    },
    useWSEvent: (type: string, handler: (payload: unknown) => void): void => {
      // Implemented via Tauri event bridge in lib/ws.ts when VITE_BACKEND=ipc.
      void type;
      void handler;
    },
  },
} as unknown as IBackend;

// Selectable backend. Default uses HTTP/WS (existing behavior).
// VITE_BACKEND=ipc switches to Tauri IPC (Phase 4 wires; throws today).

import * as api from "./api";
import * as ws from "./ws";

// The IBackend surface is intentionally the union of `api` namespace + `ws` subscriptions.
// Keep this typed via typeof so it stays in sync without restating every method.
export interface IBackend {
  boards: typeof api.boards;
  cards: typeof api.cards;
  comments: typeof api.comments;
  executions: typeof api.executions;
  commits: typeof api.commits;
  criteria: typeof api.criteria;
  config: typeof api.config;
  queue: typeof api.queue;
  tags: typeof api.tags;
  stats: typeof api.stats;
  files: typeof api.files;
  attachments: typeof api.attachments;
  ai: typeof api.ai;
  chat: typeof api.chat;
  update: typeof api.update;
  caffeinate: typeof api.caffeinate;
  terminal: typeof api.terminal;
  ws: {
    sendWS: typeof ws.sendWS;
    useWebSocket: typeof ws.useWebSocket;
    useWSEvent: typeof ws.useWSEvent;
  };
}

const mode = (import.meta.env.VITE_BACKEND as string | undefined) ?? "http";

import { httpBackend } from "./backends/http";
import { ipcBackend } from "./backends/ipc";

export const backend: IBackend = mode === "ipc" ? ipcBackend : httpBackend;

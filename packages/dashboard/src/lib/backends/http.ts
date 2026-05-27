import * as api from "../api";
import * as ws from "../ws";
import type { IBackend } from "../backend";

export const httpBackend: IBackend = {
  boards: api.boards,
  cards: api.cards,
  comments: api.comments,
  executions: api.executions,
  commits: api.commits,
  criteria: api.criteria,
  config: api.config,
  queue: api.queue,
  tags: api.tags,
  stats: api.stats,
  files: api.files,
  attachments: api.attachments,
  ai: api.ai,
  chat: api.chat,
  update: api.update,
  caffeinate: api.caffeinate,
  terminal: api.terminal,
  ws: {
    sendWS: ws.sendWS,
    useWebSocket: ws.useWebSocket,
    useWSEvent: ws.useWSEvent,
  },
};

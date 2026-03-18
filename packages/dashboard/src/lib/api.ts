const BASE = "/api";
const DEBUG = import.meta.env.DEV || import.meta.env.VITE_GPD_DEBUG === "1";

function dbg(...args: unknown[]) {
  if (DEBUG) console.debug("[gpd:api]", ...args);
}

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const method = options?.method ?? "GET";
  dbg(`→ ${method} ${path}`);
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const msg = (err as { error?: string }).error ?? res.statusText;
    console.error(`[gpd:api] ← ${method} ${path} ${res.status}:`, msg);
    throw new Error(msg);
  }
  dbg(`← ${method} ${path} ${res.status}`);
  return res.json() as Promise<T>;
}

// Boards
export const boards = {
  list: () => request<Board[]>("/boards"),
  get: (id: string) => request<Board>(`/boards/${id}`),
  create: (data: CreateBoard) =>
    request<Board>("/boards", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Board>) =>
    request<Board>(`/boards/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<{ ok: boolean }>(`/boards/${id}`, { method: "DELETE" }),
};

// Cards
export const cards = {
  list: (boardId: string) => request<CardWithTags[]>(`/cards/board/${boardId}`),
  get: (id: string) => request<CardWithTags>(`/cards/${id}`),
  create: (boardId: string, data: CreateCard) =>
    request<CardWithTags>(`/cards/board/${boardId}`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: UpdateCard) =>
    request<CardWithTags>(`/cards/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  move: (id: string, data: { status: string; position: number }) =>
    request<CardWithTags>(`/cards/${id}/move`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  reorder: (updates: Array<{ id: string; status: string; position: number }>) =>
    request<{ ok: boolean }>("/cards/reorder", {
      method: "PATCH",
      body: JSON.stringify(updates),
    }),
  delete: (id: string) =>
    request<{ ok: boolean }>(`/cards/${id}`, { method: "DELETE" }),
  execute: (id: string) =>
    request<{ ok: boolean }>(`/cards/${id}/execute`, { method: "POST" }),
  stop: (id: string) =>
    request<{ ok: boolean }>(`/cards/${id}/stop`, { method: "POST" }),
};

// Comments
export const comments = {
  list: (cardId: string) => request<Comment[]>(`/comments/card/${cardId}`),
  create: (cardId: string, data: { content: string; author?: string }) =>
    request<Comment>(`/comments/card/${cardId}`, {
      method: "POST",
      body: JSON.stringify({ author: "user", ...data }),
    }),
  clear: (cardId: string) =>
    request<{ ok: boolean }>(`/comments/card/${cardId}`, { method: "DELETE" }),
};

// Executions
export const executions = {
  list: (cardId: string) => request<Execution[]>(`/executions/card/${cardId}`),
  get: (id: string) => request<Execution>(`/executions/${id}`),
};

// Queue
export const queue = {
  status: (boardId: string) => request<QueueStatus>(`/queue/${boardId}`),
  start: (boardId: string) =>
    request<{ ok: boolean }>(`/queue/${boardId}/play`, { method: "POST" }),
  stop: (boardId: string) =>
    request<{ ok: boolean }>(`/queue/${boardId}/play`, { method: "DELETE" }),
  pause: (boardId: string) =>
    request<{ ok: boolean }>(`/queue/${boardId}/pause`, { method: "POST" }),
  resume: (boardId: string) =>
    request<{ ok: boolean }>(`/queue/${boardId}/resume`, { method: "POST" }),
};

// Config
export const config = {
  getGlobal: () => request<ConfigData>("/config"),
  updateGlobal: (data: Partial<ConfigData>) =>
    request<ConfigData>("/config", { method: "PUT", body: JSON.stringify(data) }),
  getForBoard: (boardId: string) => request<ConfigData>(`/config/board/${boardId}`),
  updateForBoard: (boardId: string, data: Partial<ConfigData>) =>
    request<ConfigData>(`/config/board/${boardId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
};

// Tags
export const tags = {
  defaults: () => request<string[]>("/tags/defaults"),
  forBoard: (boardId: string) => request<string[]>(`/tags/board/${boardId}`),
};

// Types (simplified for frontend use)
interface Board {
  id: string;
  name: string;
  description: string;
  directory: string;
  color: string | null;
  session_id: string | null;
  created_at: string;
  updated_at: string;
}

interface CreateBoard {
  name: string;
  description?: string;
  directory: string;
  color?: string | null;
}

interface CardWithTags {
  id: string;
  board_id: string;
  title: string;
  description: string;
  status: string;
  position: number;
  blocking: boolean;
  plan_thinking: "smart" | "basic" | null;
  execute_thinking: "smart" | "basic" | null;
  auto_commit: boolean | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

interface CreateCard {
  title: string;
  description?: string;
  tags?: string[];
  blocking?: boolean;
  plan_thinking?: "smart" | "basic" | null;
  execute_thinking?: "smart" | "basic" | null;
  auto_commit?: boolean | null;
}

interface UpdateCard {
  title?: string;
  description?: string;
  tags?: string[];
  status?: string;
  position?: number;
  blocking?: boolean;
  plan_thinking?: "smart" | "basic" | null;
  execute_thinking?: "smart" | "basic" | null;
  auto_commit?: boolean | null;
}

interface Comment {
  id: string;
  card_id: string;
  author: string;
  content: string;
  execution_id: string | null;
  created_at: string;
}

interface Execution {
  id: string;
  card_id: string;
  phase: string;
  status: string;
  output: string;
  cost_usd: number;
  exit_code: number | null;
  started_at: string;
  finished_at: string | null;
}

interface QueueStatus {
  boardId: string;
  queue: string[];
  current: string | null;
  isRunning: boolean;
  isPaused: boolean;
}

type CliProvider = "claude" | "gemini" | "codex" | "aider" | "copilot" | "custom";

interface ConfigData {
  cliProvider: CliProvider;
  cliCustomCommand: string;
  model: string;
  maxBudgetUsd: number;
  autoConfirm: boolean;
  autoCommit: boolean;
  planThinking: "smart" | "basic" | null;
  executeThinking: "smart" | "basic";
  customTags: string[];
  customInstructions: string;
}

export type {
  Board,
  CreateBoard,
  CardWithTags,
  CreateCard,
  UpdateCard,
  Comment,
  Execution,
  QueueStatus,
  ConfigData,
  CliProvider,
};

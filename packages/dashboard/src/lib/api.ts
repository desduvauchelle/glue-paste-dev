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
  list: (boardId: string, doneLimit = 20) =>
    request<{ cards: CardWithTags[]; doneHasMore: boolean }>(
      `/cards/board/${boardId}?done_limit=${doneLimit}`
    ),
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
  moveToBoard: (id: string, boardId: string) =>
    request<CardWithTags>(`/cards/${id}/move-to-board`, { method: "PATCH", body: JSON.stringify({ board_id: boardId }) }),
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

// Commits
export const commits = {
  list: (cardId: string) => request<CardCommit[]>(`/commits/card/${cardId}`),
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
  getForBoardRaw: (boardId: string) => request<PartialConfigData>(`/config/board/${boardId}/raw`),
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

// Files
export const files = {
  browse: (boardId: string, path?: string) =>
    request<FileEntry[]>(`/files/board/${boardId}${path ? `?path=${encodeURIComponent(path)}` : ""}`),
  tree: (boardId: string) =>
    request<{ entries: FileEntry[]; truncated: boolean }>(`/files/board/${boardId}/tree`),
};

// Attachments
export const attachments = {
  // Upload files to a card's attachment directory
  // Uses FormData, NOT JSON - so don't use the existing request() helper
  upload: async (boardId: string, cardId: string, files: FileList | File[]): Promise<string[]> => {
    const form = new FormData();
    for (const file of files) {
      form.append("files", file);
    }
    const res = await fetch(`/api/files/board/${boardId}/upload/${cardId}`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((err as { error?: string }).error ?? res.statusText);
    }
    return res.json() as Promise<string[]>;
  },

  // Delete all attachments for a card
  cleanup: (boardId: string, cardId: string) =>
    request<{ ok: boolean }>(`/files/board/${boardId}/attachments/${cardId}`, { method: "DELETE" }),

  // List attachments for a card
  list: (boardId: string, cardId: string) =>
    request<string[]>(`/files/board/${boardId}/attachments/${cardId}`),

  // Delete a single attachment file
  deleteFile: (boardId: string, cardId: string, filename: string) =>
    request<{ ok: boolean }>(`/files/board/${boardId}/attachments/${cardId}/${encodeURIComponent(filename)}`, { method: "DELETE" }),
};

// AI
export const ai = {
  generateTitle: (description: string) =>
    request<{ title: string }>("/ai/generate-title", {
      method: "POST",
      body: JSON.stringify({ description }),
    }),
};

// Chat
export const chat = {
  send: (cardId: string, data: { message: string; mode: "plan" | "execute"; thinking: "smart" | "basic" }) =>
    request<{ ok: boolean }>(`/cards/${cardId}/chat`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  stop: (cardId: string) =>
    request<{ ok: boolean; killed: boolean }>(`/cards/${cardId}/chat`, {
      method: "DELETE",
    }),
};

// Update
export const update = {
  check: () =>
    request<{ available: boolean; currentVersion: string; latestVersion: string }>("/update"),
  apply: () =>
    request<{ ok: boolean }>("/update/apply", { method: "POST" }),
  logs: () =>
    request<{ lines: string[]; message?: string }>("/update/logs"),
};

// Caffeinate
export const caffeinate = {
  status: () => request<{ active: boolean; activeBoards: Array<{ id: string; name: string }> }>("/caffeinate"),
  start: () => request<{ active: boolean }>("/caffeinate", { method: "POST" }),
  stop: () => request<{ active: boolean }>("/caffeinate", { method: "DELETE" }),
};

// Stats
export const stats = {
  boardCounts: () => request<BoardStatusCounts>("/stats/boards"),
  donePerDay: (days?: number, tzOffset?: number) => {
    const params = new URLSearchParams();
    if (days) params.set("days", String(days));
    if (tzOffset !== undefined) params.set("tzOffset", String(tzOffset));
    const qs = params.toString();
    return request<DonePerDay[]>(`/stats/done-per-day${qs ? `?${qs}` : ""}`);
  },
  donePerDayByBoard: (days?: number, tzOffset?: number) => {
    const params = new URLSearchParams();
    if (days) params.set("days", String(days));
    if (tzOffset !== undefined) params.set("tzOffset", String(tzOffset));
    const qs = params.toString();
    return request<DonePerDayByBoard>(`/stats/done-per-day-by-board${qs ? `?${qs}` : ""}`);
  },
};

// Types (simplified for frontend use)
interface Board {
  id: string;
  name: string;
  description: string;
  directory: string;
  color: string | null;
  scratchpad: string;
  slug: string | null;
  github_url: string | null;
  session_id: string | null;
  created_at: string;
  updated_at: string;
}

interface CreateBoard {
  name: string;
  description?: string;
  directory: string;
  color?: string | null;
  slug?: string | null;
  github_url?: string | null;
}

interface CardWithTags {
  id: string;
  board_id: string;
  title: string;
  description: string;
  status: string;
  position: number;
  blocking: boolean;
  plan_thinking: "smart" | "basic" | "none" | null;
  execute_thinking: "smart" | "basic" | null;
  auto_commit: boolean | null;
  auto_push: boolean | null;
  cli_provider: CliProvider | null;
  cli_custom_command: string | null;
  branch_mode: BranchMode | null;
  branch_name: string | null;
  assignee: "ai" | "human";
  tags: string[];
  files: string[];
  created_at: string;
  updated_at: string;
}

interface CreateCard {
  title: string;
  description?: string;
  tags?: string[];
  files?: string[];
  status?: "todo" | "queued";
  blocking?: boolean;
  plan_thinking?: "smart" | "basic" | "none" | null;
  execute_thinking?: "smart" | "basic" | null;
  auto_commit?: boolean | null;
  auto_push?: boolean | null;
  cli_provider?: CliProvider | null;
  cli_custom_command?: string | null;
  branch_mode?: BranchMode | null;
  branch_name?: string | null;
  assignee?: "ai" | "human";
}

interface UpdateCard {
  title?: string;
  description?: string;
  tags?: string[];
  files?: string[];
  status?: string;
  position?: number;
  blocking?: boolean;
  plan_thinking?: "smart" | "basic" | "none" | null;
  execute_thinking?: "smart" | "basic" | null;
  auto_commit?: boolean | null;
  auto_push?: boolean | null;
  cli_provider?: CliProvider | null;
  cli_custom_command?: string | null;
  branch_mode?: BranchMode | null;
  branch_name?: string | null;
  assignee?: "ai" | "human";
}

interface Comment {
  id: string;
  card_id: string;
  author: string;
  content: string;
  execution_id: string | null;
  created_at: string;
}

interface FileChange {
  path: string;
  additions: number;
  deletions: number;
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
  files_changed: string | null;
}

interface CardCommit {
  id: string;
  card_id: string;
  execution_id: string | null;
  sha: string;
  message: string;
  author_name: string;
  author_email: string;
  files_changed: string | null;
  created_at: string;
}

function parseFilesChanged(raw: string | null): FileChange[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as FileChange[];
  } catch {
    return [];
  }
}

interface QueueStatus {
  boardId: string;
  queue: string[];
  current: string | null;
  isRunning: boolean;
  isPaused: boolean;
}

type CliProvider = "claude" | "gemini" | "codex" | "aider" | "copilot" | "custom";

type BranchMode = "current" | "new" | "specific";

interface ConfigData {
  cliProvider: CliProvider;
  cliCustomCommand: string;
  model: string;
  planModel: string;
  executeModel: string;
  maxBudgetUsd: number;
  autoCommit: boolean;
  autoPush: boolean;
  planThinking: "smart" | "basic" | null;
  executeThinking: "smart" | "basic";
  customTags: string[];
  customInstructions: string;
  branchMode: BranchMode;
  branchName: string;
  maxConcurrentCards: number;
}

/** Partial config where undefined/missing fields mean "inherit from global" */
type PartialConfigData = Partial<ConfigData>;

type StatusKey = "todo" | "queued" | "in-progress" | "done" | "failed";
type BoardStatusCounts = Record<string, Record<StatusKey, number>>;
interface FileEntry {
  name: string;
  type: "file" | "directory";
  path: string;
}

interface DonePerDay {
  date: string;
  count: number;
}

type DonePerDayByBoard = Record<string, DonePerDay[]>;

export { parseFilesChanged };
export type {
  Board,
  CreateBoard,
  CardWithTags,
  CreateCard,
  UpdateCard,
  Comment,
  Execution,
  FileChange,
  CardCommit,
  QueueStatus,
  ConfigData,
  PartialConfigData,
  CliProvider,
  BranchMode,
  StatusKey,
  BoardStatusCounts,
  FileEntry,
  DonePerDay,
  DonePerDayByBoard,
};

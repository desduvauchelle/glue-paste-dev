import { invoke } from "@tauri-apps/api/core";

// Boards
export const boards = {
  list: () => invoke<Board[]>("boards_list"),
  get: (id: string) => invoke<Board>("boards_get", { id }),
  create: (data: CreateBoard) => invoke<Board>("boards_create", { input: data }),
  update: (id: string, data: Partial<Board>) =>
    invoke<Board>("boards_update", { id, input: data }),
  delete: (id: string) =>
    invoke<boolean>("boards_delete", { id }).then((deleted) => ({ ok: deleted })),
};

// Cards
export const cards = {
  list: (boardId: string, doneLimit = 20) =>
    invoke<{ cards: CardWithTags[]; done_has_more: boolean }>("cards_list_for_board", {
      boardId,
      doneLimit,
    }).then(({ cards, done_has_more }) => ({ cards, doneHasMore: done_has_more })),
  get: (id: string) => invoke<CardWithTags>("cards_get_with_tags", { id }),
  create: (boardId: string, data: CreateCard) =>
    invoke<CardWithTags>("cards_create", { boardId, input: data }),
  update: (id: string, data: UpdateCard) =>
    invoke<CardWithTags>("cards_update", { id, input: data }),
  move: (id: string, data: { status: string; position: number }) =>
    invoke<CardWithTags>("cards_move", { id, status: data.status, position: data.position }),
  reorder: (_updates: Array<{ id: string; status: string; position: number }>) =>
    Promise.reject(new Error("cards.reorder not available in IPC mode")),
  delete: (id: string) =>
    invoke<boolean>("cards_delete", { id }).then((deleted) => ({ ok: deleted })),
  moveToBoard: (_id: string, _boardId: string) =>
    Promise.reject<CardWithTags>(new Error("cards.moveToBoard not available in IPC mode")),
  execute: (id: string) =>
    invoke<void>("card_execute_single", { cardId: id }).then(() => ({ ok: true })),
  stop: (id: string) =>
    invoke<boolean>("card_stop", { cardId: id }).then(() => ({ ok: true })),
};

// Criteria
export const criteria = {
  add: (cardId: string, text: string) =>
    invoke<Criterion>("criteria_add", { cardId, input: { text, source: "user" } }),
  update: (id: string, data: { text?: string; status?: "pending" | "pass" | "fail" }) =>
    invoke<Criterion>("criteria_update", { id, input: data }),
  remove: (id: string) =>
    invoke<boolean>("criteria_remove", { id }).then(() => ({ ok: true })),
  reorder: (_updates: Array<{ id: string; position: number }>) =>
    Promise.reject(new Error("criteria.reorder requires card_id; call site must use criteria_reorder directly")),
};

// Comments
export const comments = {
  list: (cardId: string) => invoke<Comment[]>("comments_list_for_card", { cardId }),
  create: (cardId: string, data: { content: string; author?: string }) =>
    invoke<Comment>("comments_create", {
      cardId,
      input: { author: "user", ...data },
    }),
  clear: (cardId: string) =>
    invoke<number>("comments_clear", { cardId }).then(() => ({ ok: true })),
};

// Executions
export const executions = {
  list: (cardId: string) => invoke<Execution[]>("executions_list_for_card", { cardId }),
  get: (id: string) => invoke<Execution>("executions_get", { id }),
};

// Commits
export const commits = {
  list: (cardId: string) => invoke<CardCommit[]>("commits_list_for_card", { cardId }),
};

// Queue
export const queue = {
  status: (boardId: string) =>
    invoke<QueueStatus | null>("queue_get_state", { boardId }).then((s) =>
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
};

// Config
export const config = {
  getGlobal: () => invoke<ConfigData>("config_get_global"),
  updateGlobal: (data: Partial<ConfigData>) =>
    invoke<ConfigData>("config_update_global", { input: data }),
  getForBoard: (boardId: string) => invoke<ConfigData>("config_get_for_board", { boardId }),
  // Rust returns the merged config for a board; raw (un-merged) variant reuses the same command.
  getForBoardRaw: (boardId: string) =>
    invoke<PartialConfigData>("config_get_for_board", { boardId }),
  updateForBoard: (boardId: string, data: Partial<ConfigData>) =>
    invoke<ConfigData>("config_update_for_board", { boardId, input: data }),
};

// Tags
export const tags = {
  defaults: () => invoke<string[]>("tags_defaults"),
  forBoard: (boardId: string) => invoke<string[]>("tags_for_board", { boardId }),
};

// Files
export const files = {
  browse: (boardId: string, path?: string) =>
    invoke<FileEntry[]>("files_browse", { boardId, path: path ?? null }),
  tree: (boardId: string) =>
    invoke<{ entries: FileEntry[]; truncated: boolean }>("files_tree", { boardId }),
};

// Attachments. Upload not available in IPC mode (no Tauri command yet); deferred until file-picker dialog path lands.
export const attachments = {
  upload: (_boardId: string, _cardId: string, _files: FileList | File[]): Promise<string[]> =>
    Promise.reject(new Error("attachments.upload not available in IPC mode (use drag-drop or file picker)")),
  cleanup: (boardId: string, cardId: string) =>
    invoke<{ ok: boolean }>("attachments_cleanup", { boardId, cardId }),
  list: (boardId: string, cardId: string) =>
    invoke<string[]>("attachments_list", { boardId, cardId }),
  deleteFile: (boardId: string, cardId: string, filename: string) =>
    invoke<{ ok: boolean }>("attachments_delete_file", { boardId, cardId, filename }),
};

// AI
export const ai = {
  generateTitle: (description: string) =>
    invoke<string>("ai_generate_title", { args: { description } }).then((title) => ({ title })),
};

// Chat
export const chat = {
  send: (cardId: string, data: { message: string; mode: "plan" | "execute"; thinking: "smart" | "basic" }) =>
    invoke<void>("chat_start", { cardId, args: data }).then(() => ({ ok: true })),
  stop: (cardId: string) =>
    invoke<boolean>("chat_stop", { cardId }).then((killed) => ({ ok: true, killed })),
};

// Terminal
export const terminal = {
  open: (cardId: string, _size: { cols: number; rows: number }, cwd?: string) =>
    invoke<void>("terminal_open", { cardId, cwd: cwd ?? "." }).then(() => ({ ok: true, running: true })),
  status: (cardId: string) =>
    invoke<{ running: boolean; scrollback: string }>("terminal_status", { cardId }),
  close: (cardId: string) =>
    invoke<boolean>("terminal_close", { cardId }).then(() => ({ ok: true })),
  stop: (cardId: string) =>
    invoke<void>("terminal_interrupt", { cardId }).then(() => ({ ok: true })),
  killSession: (cardId: string) =>
    invoke<boolean>("terminal_kill_session", { cardId }).then(() => ({ ok: true })),
};

// Update
export const update = {
  check: () =>
    invoke<{ available: boolean; current: string; latest: string; asset_url: string | null }>("update_check").then(
      (r) => ({ available: r.available, currentVersion: r.current, latestVersion: r.latest })
    ),
  apply: (): Promise<{ ok: boolean }> => Promise.reject(new Error("update.apply not implemented in IPC mode")),
  logs: (): Promise<{ lines: string[]; message?: string }> => Promise.reject(new Error("update.logs not implemented in IPC mode")),
};

// Caffeinate
export const caffeinate = {
  status: () => invoke<{ active: boolean; activeBoards: Array<{ id: string; name: string }> }>("caffeinate_status"),
  start: () => invoke<{ active: boolean }>("caffeinate_start"),
  stop: () => invoke<{ active: boolean }>("caffeinate_stop"),
};

// Stats
export const stats = {
  boardCounts: () => invoke<BoardStatusCounts>("stats_board_counts"),
  donePerDay: (days?: number, tzOffset?: number) =>
    invoke<DonePerDay[]>("stats_done_per_day", { days: days ?? null, tzOffset: tzOffset ?? null }),
  donePerDayByBoard: (days?: number, tzOffset?: number) =>
    invoke<DonePerDayByBoard>("stats_done_per_day_by_board", {
      days: days ?? null,
      tzOffset: tzOffset ?? null,
    }),
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
  criteria: Criterion[];
  plan_summary: PlanSummary | null;
  completion_summary: string | null;
  blocker: Blocker | null;
  session_state: "working" | "idle" | null;
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

interface Criterion {
  id: string;
  card_id: string;
  text: string;
  status: "pending" | "pass" | "fail";
  source: "ai" | "user";
  evidence: string | null;
  execution_id: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

interface PlanSummary {
  key_files: string[];
  risks: string[];
  dependencies: string[];
}

interface Blocker {
  type: string;
  root_cause: string;
  resolution_route: string;
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
  Criterion,
  PlanSummary,
  Blocker,
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

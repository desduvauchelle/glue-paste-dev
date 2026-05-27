# Phase 6 — Retire Bun Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the Bun-based packages (`server`, `electron`, `cli`, `core`) and run dashboard exclusively through Tauri IPC, completing the Rust migration.

**Architecture:** Rewrite `packages/dashboard/src/lib/api.ts` to dispatch via Tauri `invoke()` instead of HTTP fetch. Inline the one shared util (`cardLabel`) from `@glue-paste-dev/core`. Delete the four Bun packages and the monorepo wiring that referenced them. Replace `build-and-install.sh` with a Tauri-only flow. Dashboard becomes the only TypeScript package.

**Tech Stack:** Tauri 2 (Rust), React 19 + Vite, `@tauri-apps/api/core::invoke`, `@tauri-apps/api/event::listen` (already integrated).

**Branch:** `feat/rust-migration-phase-6`. Base: `main` (post-Phase 2.5, commit `6d0bcf2`).

**Strangler-fig invariant lifts here:** Bun stack is being deleted. All call paths must already route through Tauri IPC before this branch merges.

---

## File Structure

**Modified:**
- `packages/dashboard/src/lib/api.ts` — rewrite all 17 namespace bodies to call `invoke()`; keep public type exports unchanged
- `packages/dashboard/src/lib/api.test.ts` — replace `mockFetch` with mocked `invoke`
- `packages/dashboard/src/lib/ws.ts` — drop the HTTP/WebSocket fallback path, always use Tauri events
- `packages/dashboard/vite.config.ts` — `outDir: "dist"`, drop server proxy
- `packages/dashboard/package.json` — drop `@glue-paste-dev/core` workspace dep
- `packages/dashboard/src/components/home/RunningCards.tsx` — import `cardLabel` from `@/lib/cardLabel` instead of core
- `packages/dashboard/src/components/board/KanbanCard.tsx` — same
- `packages/dashboard/src/components/board/KanbanCard.test.tsx` — mock `@/lib/cardLabel` instead of core
- `packages/dashboard/src/components/board/CoPlanSidebar.tsx` — same
- `packages/dashboard/src/components/board/BrainstormPanel.tsx` — same
- `package.json` — drop Bun scripts and workspace globs, add Tauri scripts
- `tsconfig.json` — remove Bun-package references, keep dashboard only
- `vitest.workspace.ts` — keep dashboard only
- `CLAUDE.md` — drop Bun type-check rows and Bun testing stack; add Rust + dashboard only
- `README.md` — replace Electron/Bun build instructions with Tauri
- `.husky/pre-commit` — drop Bun tests; run dashboard `tsc -b`, dashboard `vitest run`, `cargo check`, `cargo test`

**Created:**
- `packages/dashboard/src/lib/cardLabel.ts` — inlined from core (5 lines)
- `scripts/build-and-install.sh` — rewritten as Tauri-only installer (replace existing)

**Deleted (entire trees):**
- `packages/server/`
- `packages/electron/`
- `packages/cli/`
- `packages/core/`
- `packages/dashboard/src/lib/backend.ts` — selector indirection no longer needed
- `packages/dashboard/src/lib/backends/http.ts` — HTTP backend removed
- `packages/dashboard/src/lib/backends/ipc.ts` — content folded into `api.ts`
- `packages/dashboard/src/lib/backends/` — entire directory
- `scripts/build-electron.sh`
- `scripts/install-electron.sh`
- `scripts/install-electrobun.sh`
- `scripts/install.sh`

---

## Task 1: Inline cardLabel and update all dashboard imports

**Files:**
- Create: `packages/dashboard/src/lib/cardLabel.ts`
- Modify: `packages/dashboard/src/components/home/RunningCards.tsx` (line 10)
- Modify: `packages/dashboard/src/components/board/KanbanCard.tsx` (line 9)
- Modify: `packages/dashboard/src/components/board/KanbanCard.test.tsx` (line 20)
- Modify: `packages/dashboard/src/components/board/CoPlanSidebar.tsx` (line 10)
- Modify: `packages/dashboard/src/components/board/BrainstormPanel.tsx` (line 11)

- [ ] **Step 1: Create the inlined helper**

`packages/dashboard/src/lib/cardLabel.ts`:
```typescript
export function cardLabel(card: { title: string; description: string }): string {
  if (card.title) return card.title;
  const trimmed = card.description.slice(0, 60);
  return trimmed.length < card.description.length ? trimmed + "..." : trimmed;
}
```

- [ ] **Step 2: Update each import**

In all five files listed above, replace
```typescript
import { cardLabel } from "@glue-paste-dev/core/browser";
```
with
```typescript
import { cardLabel } from "@/lib/cardLabel";
```

For `KanbanCard.test.tsx`, the mock target also changes:
```typescript
vi.mock("@/lib/cardLabel", () => ({
  cardLabel: (c: { title: string; description: string }) => c.title || c.description,
}));
```

- [ ] **Step 3: Type-check and run tests**

```bash
cd packages/dashboard && bunx tsc -b && bunx vitest run
```
Expected: all 194 tests pass, no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/lib/cardLabel.ts \
        packages/dashboard/src/components/home/RunningCards.tsx \
        packages/dashboard/src/components/board/KanbanCard.tsx \
        packages/dashboard/src/components/board/KanbanCard.test.tsx \
        packages/dashboard/src/components/board/CoPlanSidebar.tsx \
        packages/dashboard/src/components/board/BrainstormPanel.tsx
git commit -m "refactor(dashboard): inline cardLabel, drop @glue-paste-dev/core import"
```

---

## Task 2: Rewrite api.ts to use Tauri invoke

**Files:**
- Modify: `packages/dashboard/src/lib/api.ts` — replace `request()` and every namespace body
- Modify: `packages/dashboard/src/lib/api.test.ts` — replace fetch mocking with invoke mocking

The 17 namespace bodies (the implementation parts only — `boards`, `cards`, `criteria`, `comments`, `executions`, `commits`, `queue`, `config`, `tags`, `files`, `attachments`, `ai`, `chat`, `terminal`, `update`, `caffeinate`, `stats`) get replaced. Everything from line 264 onward (the type interfaces, `parseFilesChanged`, type re-exports) stays unchanged.

The full replacement source is in the next step. Type interfaces below the dividing line are preserved verbatim.

- [ ] **Step 1: Replace the head of api.ts (lines 1 — 263)**

The block to replace runs from the top of `packages/dashboard/src/lib/api.ts` through the closing `}` of `stats` on line 262. The replacement:

```typescript
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
        ? s
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
  apply: () => Promise.reject(new Error("update.apply not implemented in IPC mode")),
  logs: () => Promise.reject(new Error("update.logs not implemented in IPC mode")),
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
```

Verify: every existing namespace export (`boards`, `cards`, `criteria`, `comments`, `executions`, `commits`, `queue`, `config`, `tags`, `files`, `attachments`, `ai`, `chat`, `terminal`, `update`, `caffeinate`, `stats`) is present and signatures match the old file.

- [ ] **Step 2: Rewrite api.test.ts to mock invoke**

Replace the entire contents of `packages/dashboard/src/lib/api.test.ts` with:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import { boards, cards, comments, queue, chat, terminal, parseFilesChanged } from "./api";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("boards", () => {
  it("list invokes boards_list", async () => {
    mockInvoke.mockResolvedValue([]);
    await boards.list();
    expect(mockInvoke).toHaveBeenCalledWith("boards_list");
  });

  it("create invokes boards_create with input wrapper", async () => {
    mockInvoke.mockResolvedValue({ id: "1", name: "Test" });
    await boards.create({ name: "Test", directory: "/tmp" });
    expect(mockInvoke).toHaveBeenCalledWith("boards_create", {
      input: { name: "Test", directory: "/tmp" },
    });
  });

  it("delete invokes boards_delete and wraps result", async () => {
    mockInvoke.mockResolvedValue(true);
    const result = await boards.delete("board-1");
    expect(mockInvoke).toHaveBeenCalledWith("boards_delete", { id: "board-1" });
    expect(result).toEqual({ ok: true });
  });
});

describe("cards", () => {
  it("list invokes cards_list_for_board with doneLimit default", async () => {
    mockInvoke.mockResolvedValue({ cards: [], done_has_more: false });
    const result = await cards.list("board-1");
    expect(mockInvoke).toHaveBeenCalledWith("cards_list_for_board", {
      boardId: "board-1",
      doneLimit: 20,
    });
    expect(result).toEqual({ cards: [], doneHasMore: false });
  });

  it("create invokes cards_create with input wrapper", async () => {
    mockInvoke.mockResolvedValue({ id: "c1", title: "Test" });
    await cards.create("board-1", { title: "Test" });
    expect(mockInvoke).toHaveBeenCalledWith("cards_create", {
      boardId: "board-1",
      input: { title: "Test" },
    });
  });

  it("move invokes cards_move with flattened args", async () => {
    mockInvoke.mockResolvedValue({ id: "c1" });
    await cards.move("c1", { status: "done", position: 0 });
    expect(mockInvoke).toHaveBeenCalledWith("cards_move", {
      id: "c1",
      status: "done",
      position: 0,
    });
  });

  it("execute invokes card_execute_single and returns ok", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const result = await cards.execute("c1");
    expect(mockInvoke).toHaveBeenCalledWith("card_execute_single", { cardId: "c1" });
    expect(result).toEqual({ ok: true });
  });
});

describe("comments", () => {
  it("list invokes comments_list_for_card", async () => {
    mockInvoke.mockResolvedValue([]);
    await comments.list("card-1");
    expect(mockInvoke).toHaveBeenCalledWith("comments_list_for_card", { cardId: "card-1" });
  });

  it("create sends author as user by default", async () => {
    mockInvoke.mockResolvedValue({ id: "cm1" });
    await comments.create("card-1", { content: "hello" });
    expect(mockInvoke).toHaveBeenCalledWith("comments_create", {
      cardId: "card-1",
      input: { author: "user", content: "hello" },
    });
  });

  it("create allows overriding author", async () => {
    mockInvoke.mockResolvedValue({ id: "cm1" });
    await comments.create("card-1", { content: "hello", author: "claude" });
    expect(mockInvoke).toHaveBeenCalledWith("comments_create", {
      cardId: "card-1",
      input: { author: "claude", content: "hello" },
    });
  });
});

describe("queue", () => {
  it("status returns default shape when state is null", async () => {
    mockInvoke.mockResolvedValue(null);
    const result = await queue.status("board-1");
    expect(result).toEqual({
      boardId: "board-1",
      queue: [],
      current: null,
      isRunning: false,
      isPaused: false,
    });
  });

  it("start invokes queue_start and returns ok", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const result = await queue.start("board-1");
    expect(mockInvoke).toHaveBeenCalledWith("queue_start", { boardId: "board-1" });
    expect(result).toEqual({ ok: true });
  });
});

describe("chat", () => {
  it("send invokes chat_start with args wrapper", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await chat.send("c1", { message: "hi", mode: "plan", thinking: "smart" });
    expect(mockInvoke).toHaveBeenCalledWith("chat_start", {
      cardId: "c1",
      args: { message: "hi", mode: "plan", thinking: "smart" },
    });
  });

  it("stop invokes chat_stop and wraps killed flag", async () => {
    mockInvoke.mockResolvedValue(true);
    const result = await chat.stop("c1");
    expect(result).toEqual({ ok: true, killed: true });
  });
});

describe("terminal", () => {
  it("open invokes terminal_open with cwd default", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const result = await terminal.open("c1", { cols: 80, rows: 24 });
    expect(mockInvoke).toHaveBeenCalledWith("terminal_open", { cardId: "c1", cwd: "." });
    expect(result).toEqual({ ok: true, running: true });
  });

  it("close invokes terminal_close", async () => {
    mockInvoke.mockResolvedValue(true);
    await terminal.close("c1");
    expect(mockInvoke).toHaveBeenCalledWith("terminal_close", { cardId: "c1" });
  });
});

describe("parseFilesChanged", () => {
  it("returns empty array for null", () => {
    expect(parseFilesChanged(null)).toEqual([]);
  });

  it("parses JSON array", () => {
    const raw = '[{"path":"a.ts","additions":1,"deletions":0}]';
    expect(parseFilesChanged(raw)).toEqual([{ path: "a.ts", additions: 1, deletions: 0 }]);
  });

  it("returns empty array on parse error", () => {
    expect(parseFilesChanged("not json")).toEqual([]);
  });
});
```

- [ ] **Step 3: Verify dashboard tests pass and tsc clean**

```bash
cd packages/dashboard && bunx tsc -b && bunx vitest run
```
Expected: 194 tests pass (existing count) plus the rewritten api.test.ts cases. No type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/lib/api.ts packages/dashboard/src/lib/api.test.ts
git commit -m "refactor(dashboard): rewrite api.ts to dispatch via Tauri invoke"
```

---

## Task 3: Drop backend selector indirection and HTTP/WS fallback

**Files:**
- Modify: `packages/dashboard/src/lib/ws.ts` — remove HTTP WebSocket path entirely; keep only Tauri event bridge
- Delete: `packages/dashboard/src/lib/backend.ts`
- Delete: `packages/dashboard/src/lib/backends/http.ts`
- Delete: `packages/dashboard/src/lib/backends/ipc.ts`
- Delete: `packages/dashboard/src/lib/backends/` (entire directory after the two files above are gone)

- [ ] **Step 1: Verify nothing imports the soon-to-be-deleted modules**

```bash
grep -rn "from.*backends/\|from.*['\"].*/backend['\"]" packages/dashboard/src 2>/dev/null
```
Expected: no matches.

- [ ] **Step 2: Rewrite ws.ts to use Tauri events only**

Replace the entire contents of `packages/dashboard/src/lib/ws.ts` with:

```typescript
import { useEffect, useRef, useCallback } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

interface WSEvent {
  type: string;
  payload: unknown;
}

type WSListener = (event: WSEvent) => void;

const DEBUG = import.meta.env.DEV || import.meta.env.VITE_GPD_DEBUG === "1";
function dbg(...args: unknown[]) {
  if (DEBUG) console.debug("[gpd:ws]", ...args);
}

const listeners = new Set<WSListener>();

const TAURI_WS_EVENTS = [
  "execution:started",
  "execution:output",
  "execution:completed",
  "card:updated",
  "comment:added",
  "queue:updated",
  "queue:stopped",
  "notification",
  "chat:output",
  "chat:completed",
  "terminal:output",
  "terminal:exited",
  "terminal:permission-pending",
  "terminal:idle",
  "terminal:session-state",
] as const;

function dispatch(event: WSEvent): void {
  for (const fn of listeners) fn(event);
}

const unlistenFns: UnlistenFn[] = [];
let bridgeStarted = false;

function startBridge(): void {
  if (bridgeStarted) return;
  bridgeStarted = true;
  for (const evtType of TAURI_WS_EVENTS) {
    listen<unknown>(evtType, (e) => {
      dbg("tauri←", evtType, e.payload);
      dispatch({ type: evtType, payload: e.payload });
    })
      .then((un) => unlistenFns.push(un))
      .catch((err) => {
        console.error("[gpd:ws] Failed to register Tauri listener for", evtType, err);
      });
  }
  dbg("Tauri event bridge active");
}

startBridge();

/** Send a message to the backend. In Tauri mode, only terminal:input and terminal:resize are routed. */
export function sendWS(message: unknown): boolean {
  const msg = message as { type?: string; cardId?: string; data?: string; cols?: number; rows?: number };
  if (!msg?.type?.startsWith("terminal:") || !msg.cardId) return false;
  switch (msg.type) {
    case "terminal:input":
      if (typeof msg.data === "string") {
        invoke<void>("terminal_input", { cardId: msg.cardId, data: msg.data }).catch(() => {});
      }
      return true;
    case "terminal:resize":
      if (typeof msg.cols === "number" && typeof msg.rows === "number") {
        invoke<void>("terminal_resize", { cardId: msg.cardId, cols: msg.cols, rows: msg.rows }).catch(() => {});
      }
      return true;
    default:
      return false;
  }
}

/** Subscribe a callback to every WS event. Returns unsubscribe. */
export function subscribe(listener: WSListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React hook: subscribe to all WS events for the lifetime of the component. */
export function useWebSocket(onEvent: WSListener): void {
  const ref = useRef(onEvent);
  ref.current = onEvent;
  useEffect(() => {
    const unsub = subscribe((evt) => ref.current(evt));
    return unsub;
  }, []);
}

/** React hook: subscribe to a single WS event type. */
export function useWSEvent(type: string, handler: (payload: unknown) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  const onEvent = useCallback((evt: WSEvent) => {
    if (evt.type === type) ref.current(evt.payload);
  }, [type]);
  useWebSocket(onEvent);
}
```

Note: `connect()`, `reconnectTimer`, `wasConnected`, and the WebSocket constructor are all removed. The native WebSocket fallback no longer exists.

- [ ] **Step 3: Delete the obsolete backend files**

```bash
rm packages/dashboard/src/lib/backend.ts
rm packages/dashboard/src/lib/backends/http.ts
rm packages/dashboard/src/lib/backends/ipc.ts
rmdir packages/dashboard/src/lib/backends
```

- [ ] **Step 4: Verify build**

```bash
cd packages/dashboard && bunx tsc -b && bunx vitest run
```
Expected: clean type-check, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A packages/dashboard/src/lib
git commit -m "refactor(dashboard): drop HTTP/WS fallback and backend selector"
```

---

## Task 4: Update Vite config for Tauri-only build

**Files:**
- Modify: `packages/dashboard/vite.config.ts`

- [ ] **Step 1: Replace vite.config.ts**

Replace the entire contents of `packages/dashboard/vite.config.ts` with:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
```

Removed: the `server.proxy` block (no Bun server to proxy to) and the `outDir: "../server/public"` (the directory is being deleted).

- [ ] **Step 2: Verify dashboard builds**

```bash
cd packages/dashboard && bun run build
ls dist/
```
Expected: `dist/index.html` and `dist/assets/` exist.

- [ ] **Step 3: Verify Tauri picks up dist**

`rust/crates/tauri-app/tauri.conf.json` already points `frontendDist` at `../../../packages/dashboard/dist`. From the repo root:

```bash
cd rust/crates/tauri-app && cargo check
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/vite.config.ts
git commit -m "build(dashboard): output to dist/ for Tauri consumption"
```

---

## Task 5: Delete Bun packages and update workspace wiring

**Files:**
- Delete: `packages/server/` (entire tree)
- Delete: `packages/electron/` (entire tree)
- Delete: `packages/cli/` (entire tree)
- Delete: `packages/core/` (entire tree)
- Modify: `package.json` — drop Bun scripts, drop workspaces glob (dashboard is the only TS package)
- Modify: `tsconfig.json` — drop refs to server/core/cli
- Modify: `vitest.workspace.ts` — drop refs to server/core (keep dashboard)

- [ ] **Step 1: Delete the four Bun package trees**

```bash
git rm -rf packages/server packages/electron packages/cli packages/core
```

Expected: no errors, four directories scheduled for deletion.

- [ ] **Step 2: Replace root package.json**

Replace the entire `package.json` contents with:

```json
{
  "name": "glue-paste-dev",
  "version": "0.1.321",
  "private": true,
  "workspaces": [
    "packages/dashboard"
  ],
  "scripts": {
    "dev:dashboard": "VITE_GPD_DEBUG=1 bun run --cwd packages/dashboard dev",
    "dev:tauri": "cd rust/crates/tauri-app && cargo tauri dev",
    "build": "bun run build:dashboard && bun run build:tauri",
    "build:dashboard": "bun run --cwd packages/dashboard build",
    "build:tauri": "bash scripts/build-tauri.sh",
    "test": "cd packages/dashboard && bunx vitest run",
    "test:coverage": "cd packages/dashboard && bun run test:coverage",
    "test:rust": "cd rust && cargo test --workspace",
    "install:local": "bash scripts/build-and-install.sh",
    "format": "prettier --write \"packages/dashboard/src/**/*.{ts,tsx}\"",
    "format:check": "prettier --check \"packages/dashboard/src/**/*.{ts,tsx}\"",
    "prepare": "husky"
  },
  "devDependencies": {
    "bun-types": "^1.3.11",
    "husky": "^9.1.7",
    "prettier": "3.8.1",
    "typescript": "^5.8.3",
    "vitest": "^3.1.1"
  }
}
```

Keep the existing version number (`0.1.321`) — the pre-commit hook will bump it on the next commit.

- [ ] **Step 3: Replace root tsconfig.json**

Replace with:

```json
{
  "files": [],
  "references": [
    { "path": "packages/dashboard" }
  ]
}
```

- [ ] **Step 4: Replace vitest.workspace.ts**

```typescript
import { defineWorkspace } from "vitest/config";

export default defineWorkspace(["packages/dashboard"]);
```

- [ ] **Step 5: Drop the @glue-paste-dev/core dep from dashboard**

In `packages/dashboard/package.json`, remove the line:
```json
"@glue-paste-dev/core": "workspace:*",
```

- [ ] **Step 6: Refresh dependencies and verify**

```bash
rm -rf node_modules packages/dashboard/node_modules bun.lockb
bun install
cd packages/dashboard && bunx tsc -b && bunx vitest run
```
Expected: install succeeds, dashboard tests pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: remove Bun stack — server/electron/cli/core packages deleted"
```

---

## Task 6: Replace install scripts with Tauri-only flow

**Files:**
- Delete: `scripts/build-electron.sh`
- Delete: `scripts/install-electron.sh`
- Delete: `scripts/install-electrobun.sh`
- Delete: `scripts/install.sh`
- Modify: `scripts/build-and-install.sh` — rewrite as Tauri installer

- [ ] **Step 1: Delete obsolete scripts**

```bash
git rm scripts/build-electron.sh scripts/install-electron.sh scripts/install-electrobun.sh scripts/install.sh
```

- [ ] **Step 2: Rewrite build-and-install.sh**

Replace the entire contents of `scripts/build-and-install.sh` with:

```bash
#!/bin/bash
set -e

# Build GluePaste (Tauri app) from source and install to /Applications/.
# This replaces the previous Electron-based installer.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="GluePaste.app"
BUILT_APP="$REPO_ROOT/rust/target/release/bundle/macos/$APP_NAME"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info() { echo -e "${BLUE}▸${NC} $1"; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "This installer is macOS-only."

# Build
info "Building GluePaste (Tauri) from source..."
bash "$REPO_ROOT/scripts/build-tauri.sh"
[ -d "$BUILT_APP" ] || fail "Built app not found at $BUILT_APP"

# Stop any running instance
if pgrep -f "/Applications/$APP_NAME" >/dev/null 2>&1; then
  info "Quitting running GluePaste..."
  osascript -e 'quit app "GluePaste"' 2>/dev/null || true
  sleep 1
  pkill -f "/Applications/$APP_NAME" 2>/dev/null || true
fi

# Install
info "Installing to /Applications/..."
[ -d "/Applications/$APP_NAME" ] && rm -rf "/Applications/$APP_NAME"
cp -R "$BUILT_APP" /Applications/

# Strip macOS quarantine (app is unsigned)
info "Removing macOS quarantine..."
xattr -cr "/Applications/$APP_NAME"

ok "$APP_NAME installed to /Applications/"

# Launch
info "Launching GluePaste..."
open "/Applications/$APP_NAME"

echo ""
ok "Done! GluePaste built and installed."
```

- [ ] **Step 3: Verify the script is executable**

```bash
chmod +x scripts/build-and-install.sh
```

- [ ] **Step 4: Commit**

```bash
git add -A scripts/
git commit -m "build: replace Electron install scripts with Tauri-only flow"
```

---

## Task 7: Update pre-commit hook to drop Bun tests

**Files:**
- Modify: `.husky/pre-commit`

- [ ] **Step 1: Replace pre-commit hook**

Replace the entire contents of `.husky/pre-commit` with:

```bash
export PATH="$HOME/.bun/bin:$PATH"

# 1. Auto-bump patch version and stage
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
const v = pkg.version.split('.');
v[2] = parseInt(v[2]) + 1;
pkg.version = v.join('.');
fs.writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
"
git add package.json

# 2. Type check + test dashboard
cd packages/dashboard
~/.bun/bin/bun x tsc -b
~/.bun/bin/bun x vitest run
cd ../..

# 3. Rust check
cd rust
cargo check --workspace
cd ..
```

- [ ] **Step 2: Smoke-test the hook on a trivial change**

```bash
echo "" >> README.md   # whitespace-only; will be reverted next step
git add README.md
git commit --dry-run -m "test"   # don't actually commit; just confirm hook runs
git restore --staged README.md
git checkout README.md
```
Expected: pre-commit runs through tsc + vitest + cargo check without errors.

- [ ] **Step 3: Commit the hook update**

```bash
git add .husky/pre-commit
git commit -m "chore: update pre-commit to dashboard + cargo only"
```

---

## Task 8: Update CLAUDE.md and README.md

**Files:**
- Modify: `CLAUDE.md` — drop Bun packages from type-check table, drop testing rows, point at Rust + dashboard
- Modify: `README.md` — replace Electron/Bun build sections with Tauri instructions

- [ ] **Step 1: Replace the Project Structure and TypeScript sections in CLAUDE.md**

Replace lines 1 — 50 of `CLAUDE.md` (everything up to and including the Testing section header) with:

```markdown
# CLAUDE.md — glue-paste-dev

## Project Structure

The application is a Tauri 2 app:

- `packages/dashboard` — React 19 frontend (Vite + Tailwind v4). The only TypeScript package.
- `rust/crates/core` — shared types, schemas, DB layer, executor logic.
- `rust/crates/tauri-app` — Tauri 2 host: window, IPC commands, event emission.
- `rust/crates/cli` — `glue-paste-dev` CLI (start/stop/status/logs/add/update/uninstall).

## TypeScript + Rust — Run After Every Change

After writing or editing code, always type-check before considering the task done.

| Package | Type check command |
|---|---|
| `packages/dashboard` | `cd packages/dashboard && bunx tsc -b` |
| `rust/crates/core` | `cd rust && cargo check -p glue-paste-dev-core` |
| `rust/crates/tauri-app` | `cd rust && cargo check -p glue-paste-dev-tauri` |
| `rust/crates/cli` | `cd rust && cargo check -p glue-paste-dev-cli` |

Fix all type errors before finishing. Do not leave `// @ts-ignore` or `any` casts unless the user explicitly approves them.

## Testing
```

Replace the Testing section's "Testing stack" table with:

```markdown
### Testing stack

| Package | Runner | Libraries |
|---|---|---|
| `packages/dashboard` | Vitest (`vitest run`) | Vitest + @testing-library/react + @testing-library/jest-dom + jsdom |
| `rust/crates/core` | `cargo test` | Bun parity fixtures |
| `rust/crates/tauri-app` | `cargo test` | Tauri test utils |
```

Replace the "When to write tests" bullets with:

```markdown
### When to write tests

- **New business logic** in `rust/crates/core`: write a Rust unit test alongside the implementation.
- **New Tauri commands**: write an integration test in `rust/crates/tauri-app/tests/`.
- **New React components or hooks** in `dashboard` with non-trivial behaviour: write a component test with `@testing-library/react`.
- **Bug fixes**: add a regression test that fails before the fix and passes after.
```

Replace the "Running tests" block with:

```bash
# Per package
cd packages/dashboard && bunx vitest run
cd rust && cargo test --workspace
```

- [ ] **Step 2: Update README.md**

Show the new top-level sections. Replace the existing `README.md` Install/Develop/Build sections with:

```markdown
## Install (macOS)

```bash
bash scripts/build-and-install.sh
```

Builds the Tauri app from source and copies it to `/Applications/GluePaste.app`.

## Develop

```bash
# Hot-reload Tauri + dashboard
cd rust/crates/tauri-app && cargo tauri dev

# Or run the dashboard alone (no native window)
cd packages/dashboard && bun run dev
```

## Build a release

```bash
bash scripts/build-tauri.sh
# Output: rust/target/release/bundle/macos/GluePaste.app
```

## Test

```bash
cd packages/dashboard && bunx vitest run
cd rust && cargo test --workspace
```
```

Preserve any badges, project description, license, or unrelated sections; only the install/develop/build/test blocks change.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: update CLAUDE.md and README.md for post-Bun architecture"
```

---

## Task 9: Final integration check

- [ ] **Step 1: Clean build from scratch**

```bash
rm -rf node_modules packages/dashboard/node_modules bun.lockb
bun install
cd packages/dashboard && bun run build && cd ../..
cd rust && cargo build --release && cd ..
```
Expected: dashboard builds to `dist/`, Rust workspace builds cleanly.

- [ ] **Step 2: Run all tests**

```bash
cd packages/dashboard && bunx vitest run && cd ../..
cd rust && cargo test --workspace && cd ..
```
Expected: dashboard tests pass (194+), Rust tests pass (149+).

- [ ] **Step 3: Install + launch the Tauri app**

```bash
bash scripts/build-and-install.sh
```
Expected: GluePaste.app installed to `/Applications/`, opens window showing existing boards loaded via IPC.

- [ ] **Step 4: Commit a final summary if anything changed**

If the integration check surfaced fixes, commit them:

```bash
git add -A
git commit -m "fix: post-migration integration cleanup"
```

If no changes needed, skip this step.

---

## Acceptance

- [x] Bun packages (`server`, `electron`, `cli`, `core`) deleted from `packages/`
- [x] Dashboard talks to Tauri exclusively via `invoke()` and `listen()`
- [x] `bun run build` produces `packages/dashboard/dist/`
- [x] `bash scripts/build-tauri.sh` produces `GluePaste.app`
- [x] All dashboard vitest tests pass
- [x] `cargo test --workspace` passes
- [x] `cargo check --workspace` passes
- [x] Pre-commit hook runs successfully (dashboard tsc + vitest, cargo check)
- [x] No remaining references to `packages/server`, `packages/electron`, `packages/cli`, `packages/core`, `@glue-paste-dev/core`, or the old backend selector

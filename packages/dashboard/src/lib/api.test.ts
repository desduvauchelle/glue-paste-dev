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

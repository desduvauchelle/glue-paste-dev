import { describe, it, expect, vi, beforeEach } from "vitest";
import { boards, cards, comments, queue, chat, parseFilesChanged } from "./api";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function mockJsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(data),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("boards", () => {
  it("list calls GET /api/boards", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse([]));
    await boards.list();
    expect(mockFetch).toHaveBeenCalledWith("/api/boards", expect.any(Object));
  });

  it("create calls POST /api/boards with body", async () => {
    const board = { id: "1", name: "Test" };
    mockFetch.mockResolvedValue(mockJsonResponse(board));
    await boards.create({ name: "Test", directory: "/tmp" });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/boards",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("delete calls DELETE /api/boards/:id", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await boards.delete("board-1");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/boards/board-1",
      expect.objectContaining({ method: "DELETE" })
    );
  });
});

describe("cards", () => {
  it("list calls GET /api/cards/board/:boardId", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ cards: [], doneHasMore: false }));
    await cards.list("board-1");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/cards/board/board-1?done_limit=20",
      expect.any(Object)
    );
  });

  it("create calls POST /api/cards/board/:boardId", async () => {
    const card = { id: "c1", title: "Test" };
    mockFetch.mockResolvedValue(mockJsonResponse(card));
    await cards.create("board-1", { title: "Test" });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/cards/board/board-1",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("move calls PATCH /api/cards/:id/move", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ id: "c1" }));
    await cards.move("c1", { status: "done", position: 0 });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/cards/c1/move",
      expect.objectContaining({ method: "PATCH" })
    );
  });

  it("execute calls POST /api/cards/:id/execute", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await cards.execute("c1");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/cards/c1/execute",
      expect.objectContaining({ method: "POST" })
    );
  });
});

describe("comments", () => {
  it("list calls GET /api/comments/card/:cardId", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse([]));
    await comments.list("card-1");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/comments/card/card-1",
      expect.any(Object)
    );
  });

  it("create sends author as user by default", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ id: "cm1" }));
    await comments.create("card-1", { content: "hello" });
    const call = mockFetch.mock.calls[0]!;
    const body = JSON.parse(call[1].body);
    expect(body.author).toBe("user");
    expect(body.content).toBe("hello");
  });
});

describe("chat", () => {
  it("send calls POST /api/cards/:id/chat", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await chat.send("c1", { message: "hi", mode: "plan", thinking: "smart" });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/cards/c1/chat",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("stop calls DELETE /api/cards/:id/chat", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, killed: true }));
    await chat.stop("c1");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/cards/c1/chat",
      expect.objectContaining({ method: "DELETE" })
    );
  });
});

describe("queue", () => {
  it("start calls POST /api/queue/:boardId/play", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await queue.start("b1");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/queue/b1/play",
      expect.objectContaining({ method: "POST" })
    );
  });
});

describe("error handling", () => {
  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ error: "Not found" }, 404));
    await expect(boards.get("nonexistent")).rejects.toThrow("Not found");
  });

  it("falls back to statusText when no error field", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: () => Promise.reject(new Error("parse error")),
    });
    await expect(boards.get("bad")).rejects.toThrow("Internal Server Error");
  });
});

describe("parseFilesChanged", () => {
  it("returns empty array for null", () => {
    expect(parseFilesChanged(null)).toEqual([]);
  });

  it("parses valid JSON", () => {
    const files = [{ path: "a.ts", additions: 1, deletions: 0 }];
    expect(parseFilesChanged(JSON.stringify(files))).toEqual(files);
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseFilesChanged("not json")).toEqual([]);
  });
});

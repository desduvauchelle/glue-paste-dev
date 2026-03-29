import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

// Mock the WebSocket hook
vi.mock("@/lib/ws", () => ({
  useWebSocket: vi.fn(),
}));

// Mock the API module
vi.mock("@/lib/api", () => ({
  cards: {
    list: vi.fn().mockResolvedValue({ cards: [], doneHasMore: false }),
    create: vi.fn(),
    update: vi.fn(),
    move: vi.fn(),
    reorder: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
    stop: vi.fn(),
  },
}));

import { useCards } from "./use-cards";
import { cards as cardsApi } from "@/lib/api";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(cardsApi.list).mockResolvedValue({ cards: [], doneHasMore: false });
});

describe("useCards", () => {
  it("returns empty cards array initially", async () => {
    const { result } = renderHook(() => useCards("board-1"));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.cards).toEqual([]);
  });

  it("calls cardsApi.list with boardId on mount", async () => {
    renderHook(() => useCards("board-1"));
    await waitFor(() => {
      expect(cardsApi.list).toHaveBeenCalledWith("board-1", 20);
    });
  });

  it("groups cards by status", async () => {
    const mockCards = [
      { id: "1", board_id: "b1", status: "todo", position: 0, created_at: "2026-01-01" },
      { id: "2", board_id: "b1", status: "done", position: 1, created_at: "2026-01-02" },
      { id: "3", board_id: "b1", status: "queued", position: 0, created_at: "2026-01-03" },
      { id: "4", board_id: "b1", status: "in-progress", position: 0, created_at: "2026-01-04" },
      { id: "5", board_id: "b1", status: "failed", position: 0, created_at: "2026-01-05" },
    ] as any[];
    vi.mocked(cardsApi.list).mockResolvedValue({ cards: mockCards, doneHasMore: false });

    const { result } = renderHook(() => useCards("b1"));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.grouped.todo).toHaveLength(1);
    expect(result.current.grouped.queued).toHaveLength(1);
    expect(result.current.grouped["in-progress"]).toHaveLength(1);
    expect(result.current.grouped.done).toHaveLength(1);
    expect(result.current.grouped.failed).toHaveLength(1);
  });

  it("create adds card optimistically", async () => {
    const newCard = { id: "new", board_id: "b1", title: "New", status: "todo" } as any;
    vi.mocked(cardsApi.create).mockResolvedValue(newCard);

    const { result } = renderHook(() => useCards("b1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.create({ title: "New" });
    });

    expect(result.current.cards).toContainEqual(newCard);
  });

  it("remove filters out deleted card", async () => {
    const mockCards = [
      { id: "1", board_id: "b1", status: "todo", position: 0 },
      { id: "2", board_id: "b1", status: "todo", position: 1 },
    ] as any[];
    vi.mocked(cardsApi.list).mockResolvedValue({ cards: mockCards, doneHasMore: false });
    vi.mocked(cardsApi.delete).mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useCards("b1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.remove("1");
    });

    expect(result.current.cards).toHaveLength(1);
    expect(result.current.cards[0]!.id).toBe("2");
  });

  it("doneHasMore reflects API response", async () => {
    vi.mocked(cardsApi.list).mockResolvedValue({ cards: [], doneHasMore: true });

    const { result } = renderHook(() => useCards("b1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.doneHasMore).toBe(true);
  });
});

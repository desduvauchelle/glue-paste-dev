import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Home } from "./Home";

const mockBoards = [
  { id: "b1", name: "Active Board", description: "desc", directory: "/tmp/a", session_id: null, created_at: "", updated_at: "2024-01-10T00:00:00Z", color: null, scratchpad: "" },
  { id: "b2", name: "Idle Board", description: "", directory: "/tmp/b", session_id: null, created_at: "", updated_at: "2024-01-05T00:00:00Z", color: null, scratchpad: "" },
];

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
}));

vi.mock("@/hooks/use-boards", () => ({
  useBoards: () => ({
    boards: mockBoards,
    loading: false,
    create: vi.fn(),
    remove: vi.fn(),
  }),
}));

vi.mock("@/lib/api", () => ({
  queue: {
    status: vi.fn((boardId: string) => {
      if (boardId === "b1") {
        return Promise.resolve({ boardId: "b1", queue: [], current: "card1", isRunning: true, isPaused: false });
      }
      return Promise.resolve({ boardId: "b2", queue: [], current: null, isRunning: false, isPaused: false });
    }),
  },
  stats: {
    boardCounts: vi.fn(() => Promise.resolve({})),
    donePerDay: vi.fn(() => Promise.resolve([])),
    donePerDayByBoard: vi.fn(() => Promise.resolve({})),
  },
  caffeinate: {
    status: vi.fn(() => Promise.resolve({ active: false })),
    start: vi.fn(() => Promise.resolve({ active: true })),
    stop: vi.fn(() => Promise.resolve({ active: false })),
  },
  update: {
    check: vi.fn(() => Promise.resolve({ available: false, currentVersion: "0.1.0", latestVersion: "0.1.0" })),
    apply: vi.fn(() => Promise.resolve({ ok: true })),
  },
  cards: {
    create: vi.fn(() => Promise.resolve({})),
    list: vi.fn(() => Promise.resolve({ cards: [], doneHasMore: false })),
    update: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve({ ok: true })),
    stop: vi.fn(() => Promise.resolve({ ok: true })),
  },
}));

vi.mock("@/lib/ws", () => ({
  useWebSocket: vi.fn(),
  useWSEvent: vi.fn(),
}));

function makeLocalStorage() {
  const store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", makeLocalStorage());
});

vi.mock("@dnd-kit/core", async (importActual) => {
  const actual = await importActual<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock("@dnd-kit/sortable", async (importActual) => {
  const actual = await importActual<typeof import("@dnd-kit/sortable")>();
  return {
    ...actual,
    SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      transform: null,
      transition: null,
      isDragging: false,
    }),
  };
});

describe("Home — activity indicator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render a delete button on board cards", async () => {
    render(<Home />);

    await waitFor(() => {
      expect(screen.getByText("Active Board")).toBeInTheDocument();
    });

    const cards = screen.getAllByText(/Board/)
      .map((el) => el.closest("[class*='cursor-pointer']"))
      .filter((el): el is HTMLElement => el !== null);
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      const buttons = card.querySelectorAll("button");
      // Each card should only have the "Add card" plus button — no trash button
      // The trash button previously had no title, add-card has title="Add card"
      const unnamedButtons = Array.from(buttons).filter((b) => !b.getAttribute("title"));
      expect(unnamedButtons).toHaveLength(0);
    }
  });

  it("shows a pulsating indicator for active boards", async () => {
    render(<Home />);

    await waitFor(() => {
      expect(screen.getByText("Active Board")).toBeInTheDocument();
    });

    // The active board card should contain the ping indicator
    const activeCard = screen.getByText("Active Board").closest("[class*='cursor-pointer']")!;
    const pingDot = activeCard.querySelector(".animate-ping");
    expect(pingDot).toBeInTheDocument();

    // The idle board card should NOT contain the ping indicator
    const idleCard = screen.getByText("Idle Board").closest("[class*='cursor-pointer']")!;
    const noPing = idleCard.querySelector(".animate-ping");
    expect(noPing).not.toBeInTheDocument();
  });
});

describe("Home — board sort modes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to 'recent' sort mode when no preference is stored", async () => {
    render(<Home />);
    await waitFor(() => expect(screen.getByText("Active Board")).toBeInTheDocument());

    const recentBtn = screen.getByRole("button", { name: /recent/i });
    expect(recentBtn).toHaveAttribute("data-active", "true");
  });

  it("persists sort mode to localStorage when changed", async () => {
    render(<Home />);
    await waitFor(() => expect(screen.getByText("Active Board")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /a-z/i }));

    expect(localStorage.getItem("glue-board-sort")).toBe("alpha");
  });

  it("reads sort mode from localStorage on mount", async () => {
    localStorage.setItem("glue-board-sort", "alpha");
    render(<Home />);
    await waitFor(() => expect(screen.getByText("Active Board")).toBeInTheDocument());

    const alphaBtn = screen.getByRole("button", { name: /a-z/i });
    expect(alphaBtn).toHaveAttribute("data-active", "true");
  });

  it("shows drag handles only in Custom mode", async () => {
    render(<Home />);
    await waitFor(() => expect(screen.getByText("Active Board")).toBeInTheDocument());

    // No drag handles initially (default: recent)
    expect(screen.queryAllByTitle("Drag to reorder")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /custom/i }));

    // Drag handles should appear for each board
    expect(screen.getAllByTitle("Drag to reorder")).toHaveLength(mockBoards.length);
  });
});

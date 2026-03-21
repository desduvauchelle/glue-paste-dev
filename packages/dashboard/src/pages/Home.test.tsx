import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Home } from "./Home";

const mockBoards = [
  { id: "b1", name: "Active Board", description: "desc", directory: "/tmp/a", session_id: null, created_at: "", updated_at: "" },
  { id: "b2", name: "Idle Board", description: "", directory: "/tmp/b", session_id: null, created_at: "", updated_at: "" },
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
}));

vi.mock("@/lib/ws", () => ({
  useWebSocket: vi.fn(),
  useWSEvent: vi.fn(),
}));

describe("Home — activity indicator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ProjectSwitcher } from "./ProjectSwitcher";

const mockBoards = [
  { id: "b1", name: "Zebra", updated_at: "2026-01-01T00:00:00Z", directory: null, color: null, description: "", session_id: null, created_at: "", scratchpad: "" },
  { id: "b2", name: "Alpha", updated_at: "2026-03-01T00:00:00Z", directory: null, color: null, description: "", session_id: null, created_at: "", scratchpad: "" },
  { id: "b3", name: "Middle", updated_at: "2026-02-01T00:00:00Z", directory: null, color: null, description: "", session_id: null, created_at: "", scratchpad: "" },
];

vi.mock("@/lib/api", () => ({
  boards: {
    list: vi.fn().mockResolvedValue([
      { id: "b1", name: "Zebra", updated_at: "2026-01-01T00:00:00Z", directory: null, color: null, description: "", session_id: null, created_at: "", scratchpad: "" },
      { id: "b2", name: "Alpha", updated_at: "2026-03-01T00:00:00Z", directory: null, color: null, description: "", session_id: null, created_at: "", scratchpad: "" },
      { id: "b3", name: "Middle", updated_at: "2026-02-01T00:00:00Z", directory: null, color: null, description: "", session_id: null, created_at: "", scratchpad: "" },
    ]),
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
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
  Element.prototype.scrollIntoView = vi.fn();
});

describe("ProjectSwitcher — sort preference", () => {
  it("sorts boards by recent (default) when no preference stored", async () => {
    render(<ProjectSwitcher currentBoardId="b1" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());

    const buttons = screen.getAllByRole("button");
    const boardButtons = buttons.filter((b) =>
      mockBoards.some((mb) => b.textContent?.includes(mb.name)),
    );
    expect(boardButtons[0]).toHaveTextContent("Alpha"); // most recent
    expect(boardButtons[1]).toHaveTextContent("Middle");
    expect(boardButtons[2]).toHaveTextContent("Zebra"); // oldest
  });

  it("sorts boards alphabetically when alpha preference is stored", async () => {
    localStorage.setItem("glue-board-sort", "alpha");
    render(<ProjectSwitcher currentBoardId="b1" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());

    const buttons = screen.getAllByRole("button");
    const boardButtons = buttons.filter((b) =>
      mockBoards.some((mb) => b.textContent?.includes(mb.name)),
    );
    expect(boardButtons[0]).toHaveTextContent("Alpha");
    expect(boardButtons[1]).toHaveTextContent("Middle");
    expect(boardButtons[2]).toHaveTextContent("Zebra");
  });

  it("sorts boards by custom order when custom preference is stored", async () => {
    localStorage.setItem("glue-board-sort", "custom");
    localStorage.setItem("glue-board-order", JSON.stringify(["b3", "b1", "b2"]));
    render(<ProjectSwitcher currentBoardId="b1" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Middle")).toBeInTheDocument());

    const buttons = screen.getAllByRole("button");
    const boardButtons = buttons.filter((b) =>
      mockBoards.some((mb) => b.textContent?.includes(mb.name)),
    );
    expect(boardButtons[0]).toHaveTextContent("Middle"); // b3
    expect(boardButtons[1]).toHaveTextContent("Zebra");  // b1
    expect(boardButtons[2]).toHaveTextContent("Alpha");  // b2
  });
});

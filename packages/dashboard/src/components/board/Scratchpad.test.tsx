import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Scratchpad } from "./Scratchpad";
import { boards } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  boards: { update: vi.fn(() => Promise.resolve({})) },
}));

const mockUpdate = vi.mocked(boards.update);

const mockBoard = {
  id: "b1",
  name: "My Project",
  description: "Test project",
  directory: "/tmp/proj",
  session_id: null,
  color: null,
  scratchpad: "",
  slug: null,
  github_url: null,
  created_at: "",
  updated_at: "",
};

describe("Scratchpad", () => {
  const onClose = vi.fn();
  const onBoardUpdated = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders with board scratchpad content", () => {
    const board = { ...mockBoard, scratchpad: "existing notes" };
    render(
      <Scratchpad
        board={board}
        onClose={onClose}
        onBoardUpdated={onBoardUpdated}
      />
    );
    expect(screen.getByDisplayValue("existing notes")).toBeInTheDocument();
  });

  it("debounces save — does not save immediately on keystroke", () => {
    render(
      <Scratchpad
        board={mockBoard}
        onClose={onClose}
        onBoardUpdated={onBoardUpdated}
      />
    );
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "hello" } });

    // No save yet — timer hasn't fired
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("saves after 800ms of inactivity", async () => {
    render(
      <Scratchpad
        board={mockBoard}
        onClose={onClose}
        onBoardUpdated={onBoardUpdated}
      />
    );
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "hello" } });

    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith("b1", { scratchpad: "hello" });
  });

  it("resets debounce timer on each keystroke", async () => {
    render(
      <Scratchpad
        board={mockBoard}
        onClose={onClose}
        onBoardUpdated={onBoardUpdated}
      />
    );
    const textarea = screen.getByRole("textbox");

    fireEvent.change(textarea, { target: { value: "h" } });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    // Another keystroke before 800ms — should reset timer
    fireEvent.change(textarea, { target: { value: "he" } });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    // Only 500ms since last keystroke — no save yet
    expect(mockUpdate).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    // Now 800ms since last keystroke — should save with latest value
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith("b1", { scratchpad: "he" });
  });

  it("saves on unmount if content changed and timer pending", async () => {
    const { unmount } = render(
      <Scratchpad
        board={mockBoard}
        onClose={onClose}
        onBoardUpdated={onBoardUpdated}
      />
    );
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "unsaved" } });

    // Unmount before debounce fires
    unmount();

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith("b1", { scratchpad: "unsaved" });
  });

  it("does not save on unmount if content unchanged", () => {
    const { unmount } = render(
      <Scratchpad
        board={mockBoard}
        onClose={onClose}
        onBoardUpdated={onBoardUpdated}
      />
    );
    unmount();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("closes on Escape key", () => {
    render(
      <Scratchpad
        board={mockBoard}
        onClose={onClose}
        onBoardUpdated={onBoardUpdated}
      />
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { BoardSettingsDialog } from "./BoardSettingsDialog";

const mockBoard = {
  id: "b1",
  name: "My Project",
  description: "Test project",
  directory: "/tmp/proj",
  session_id: null,
  color: null,
  scratchpad: "",
  slug: null,
  created_at: "",
  updated_at: "",
};

vi.mock("@/lib/api", () => ({
  boards: { update: vi.fn(() => Promise.resolve(mockBoard)) },
  config: {
    getForBoardRaw: vi.fn(() => Promise.resolve({})),
    getGlobal: vi.fn(() => Promise.resolve({})),
    updateForBoard: vi.fn(() => Promise.resolve({})),
  },
}));

describe("BoardSettingsDialog — delete confirmation", () => {
  const onDelete = vi.fn(() => Promise.resolve());
  const onOpenChange = vi.fn();
  const onUpdated = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a delete button in the General tab", () => {
    render(
      <BoardSettingsDialog
        open={true}
        onOpenChange={onOpenChange}
        board={mockBoard}
        onUpdated={onUpdated}
        onDelete={onDelete}
      />
    );
    expect(screen.getByText("Delete Board")).toBeInTheDocument();
  });

  it("requires typing the board name to enable the confirm button", () => {
    render(
      <BoardSettingsDialog
        open={true}
        onOpenChange={onOpenChange}
        board={mockBoard}
        onUpdated={onUpdated}
        onDelete={onDelete}
      />
    );

    fireEvent.click(screen.getByText("Delete Board"));
    const confirmBtn = screen.getByText("Permanently Delete");
    expect(confirmBtn).toBeDisabled();

    const input = screen.getByPlaceholderText("My Project");
    fireEvent.change(input, { target: { value: "wrong name" } });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: "My Project" } });
    expect(confirmBtn).toBeEnabled();
  });

  it("calls onDelete when confirmation is completed", async () => {
    render(
      <BoardSettingsDialog
        open={true}
        onOpenChange={onOpenChange}
        board={mockBoard}
        onUpdated={onUpdated}
        onDelete={onDelete}
      />
    );

    fireEvent.click(screen.getByText("Delete Board"));
    const input = screen.getByPlaceholderText("My Project");
    fireEvent.change(input, { target: { value: "My Project" } });
    fireEvent.click(screen.getByText("Permanently Delete"));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith("b1");
    });
  });
});

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CardDialog } from "./CardDialog";

vi.mock("@/lib/api", () => ({
  config: {
    getForBoard: vi.fn(),
  },
  comments: {
    list: vi.fn(() => Promise.resolve([])),
  },
  executions: {
    list: vi.fn(() => Promise.resolve([])),
  },
  commits: {
    list: vi.fn(() => Promise.resolve([])),
  },
  boards: {
    list: vi.fn(() => Promise.resolve([])),
    get: vi.fn(() => Promise.resolve({ id: "board-1", name: "Test", github_url: null })),
  },
  cards: {
    moveToBoard: vi.fn(() => Promise.resolve()),
  },
  attachments: {
    list: vi.fn(() => Promise.resolve([])),
    upload: vi.fn(() => Promise.resolve([])),
    cleanup: vi.fn(() => Promise.resolve({ ok: true })),
    deleteFile: vi.fn(() => Promise.resolve({ ok: true })),
  },
  parseFilesChanged: vi.fn(() => []),
}));

vi.mock("@/lib/ws", () => ({
  useWSEvent: vi.fn(),
}));

const { config: configApi } = await import("@/lib/api");

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  card: null,
  boardId: "board-1",
  onCreate: vi.fn(() => Promise.resolve()),
  onUpdate: vi.fn(() => Promise.resolve()),
  onDelete: vi.fn(() => Promise.resolve()),
  onPlay: vi.fn(),
};

describe("CardDialog — config defaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows inherited planThinking=smart from project config for new card", async () => {
    vi.mocked(configApi.getForBoard).mockResolvedValue({
      cliProvider: "claude",
      cliCustomCommand: "",
      model: "claude-opus-4-6",
      planModel: "",
      executeModel: "",
      maxBudgetUsd: 10,

      autoCommit: false,
      autoPush: false,
      planThinking: "smart",
      executeThinking: "smart",
      customTags: [],
      customInstructions: "",
      branchMode: "current" as const,
      branchName: "",
      maxConcurrentCards: 1,
    });

    render(<CardDialog {...defaultProps} card={null} />);

    await waitFor(() => {
      // The Plan row should have Smart checked
      const checkboxes = screen.getAllByRole("checkbox");
      // Find the checkbox in the Plan row next to "Smart" text
      const smartPlanCheckbox = checkboxes.find((cb) => {
        const label = cb.closest("label");
        return label?.textContent?.includes("Smart") && cb.closest(".flex.items-center.gap-2")?.querySelector(".w-11")?.textContent === "Plan";
      });
      expect(smartPlanCheckbox).toBeDefined();
      expect(smartPlanCheckbox!).toBeChecked();
    });
  });

  it("shows inherited executeThinking=smart from project config for new card", async () => {
    vi.mocked(configApi.getForBoard).mockResolvedValue({
      cliProvider: "claude",
      cliCustomCommand: "",
      model: "claude-opus-4-6",
      planModel: "",
      executeModel: "",
      maxBudgetUsd: 10,

      autoCommit: false,
      autoPush: false,
      planThinking: "basic",
      executeThinking: "smart",
      customTags: [],
      customInstructions: "",
      branchMode: "current" as const,
      branchName: "",
      maxConcurrentCards: 1,
    });

    render(<CardDialog {...defaultProps} card={null} />);

    await waitFor(() => {
      const radios = screen.getAllByRole("radio");
      // Find the radio in the Exec row next to "Smart" text
      const smartExecRadio = radios.find((r) => {
        const label = r.closest("label");
        return label?.textContent?.includes("Smart") && r.closest(".flex.items-center.gap-2")?.querySelector(".w-11")?.textContent === "Exec";
      });
      expect(smartExecRadio).toBeDefined();
      expect(smartExecRadio!).toBeChecked();
    });
  });

  it("shows card-level override instead of config default", async () => {
    vi.mocked(configApi.getForBoard).mockResolvedValue({
      cliProvider: "claude",
      cliCustomCommand: "",
      model: "claude-opus-4-6",
      planModel: "",
      executeModel: "",
      maxBudgetUsd: 10,

      autoCommit: false,
      autoPush: false,
      planThinking: "smart",
      executeThinking: "smart",
      customTags: [],
      customInstructions: "",
      branchMode: "current" as const,
      branchName: "",
      maxConcurrentCards: 1,
    });

    const cardWithOverride = {
      id: "card-1",
      board_id: "board-1",
      title: "Test card",
      description: "desc",
      status: "todo" as const,
      position: 0,
      blocking: false,
      plan_thinking: "basic" as const,
      execute_thinking: null,
      auto_commit: null,
      auto_push: null,
      cli_provider: null,
      cli_custom_command: null,
      branch_mode: null,
      branch_name: null,
      assignee: "ai" as const,
      files: [],
      tags: [],
      created_at: "",
      updated_at: "",
    };

    render(<CardDialog {...defaultProps} card={cardWithOverride} />);

    await waitFor(() => {
      const checkboxes = screen.getAllByRole("checkbox");
      // Find the checkbox in the Plan row next to "Normal" text (basic)
      const basicPlanCheckbox = checkboxes.find((cb) => {
        const label = cb.closest("label");
        return label?.textContent?.includes("Normal") && cb.closest(".flex.items-center.gap-2")?.querySelector(".w-11")?.textContent === "Plan";
      });
      expect(basicPlanCheckbox).toBeDefined();
      expect(basicPlanCheckbox!).toBeChecked();
    });
  });

  it("preselects inherited autoCommit value for new card (no Inherit radio visible)", async () => {
    vi.mocked(configApi.getForBoard).mockResolvedValue({
      cliProvider: "claude",
      cliCustomCommand: "",
      model: "claude-opus-4-6",
      planModel: "",
      executeModel: "",
      maxBudgetUsd: 10,

      autoCommit: true,
      autoPush: false,
      planThinking: "smart",
      executeThinking: "smart",
      customTags: [],
      customInstructions: "",
      branchMode: "current" as const,
      branchName: "",
      maxConcurrentCards: 1,
    });

    render(<CardDialog {...defaultProps} card={null} />);

    await waitFor(() => {
      const autoCommitLabel = screen.getByText(/auto-commit/i);
      const autoCommitSwitch = autoCommitLabel.closest("div")?.querySelector('[role="switch"]');
      expect(autoCommitSwitch).toBeDefined();
      expect(autoCommitSwitch).toHaveAttribute("aria-checked", "true");
    });
  });

  it("preselects inherited autoPush=Off for new card", async () => {
    vi.mocked(configApi.getForBoard).mockResolvedValue({
      cliProvider: "claude",
      cliCustomCommand: "",
      model: "claude-opus-4-6",
      planModel: "",
      executeModel: "",
      maxBudgetUsd: 10,

      autoCommit: false,
      autoPush: false,
      planThinking: "smart",
      executeThinking: "smart",
      customTags: [],
      customInstructions: "",
      branchMode: "current" as const,
      branchName: "",
      maxConcurrentCards: 1,
    });

    render(<CardDialog {...defaultProps} card={null} />);

    await waitFor(() => {
      const autoPushLabel = screen.getByText(/auto-push/i);
      const autoPushSwitch = autoPushLabel.closest("div")?.querySelector('[role="switch"]');
      expect(autoPushSwitch).toBeDefined();
      expect(autoPushSwitch).toHaveAttribute("aria-checked", "false");
    });
  });

  it("refreshes config defaults when dialog is reopened after config change", async () => {
    // Initial open: planThinking = "smart"
    vi.mocked(configApi.getForBoard).mockResolvedValueOnce({
      cliProvider: "claude",
      cliCustomCommand: "",
      model: "claude-opus-4-6",
      planModel: "",
      executeModel: "",
      maxBudgetUsd: 10,
      autoCommit: false,
      autoPush: false,
      planThinking: "smart",
      executeThinking: "smart",
      customTags: [],
      customInstructions: "",
      branchMode: "current" as const,
      branchName: "",
      maxConcurrentCards: 1,
    });

    const { rerender } = render(<CardDialog {...defaultProps} open={true} card={null} />);

    await waitFor(() => {
      expect(configApi.getForBoard).toHaveBeenCalledTimes(1);
    });

    // Close the dialog
    rerender(<CardDialog {...defaultProps} open={false} card={null} />);

    // Config was updated to planThinking = "basic" (Normal)
    vi.mocked(configApi.getForBoard).mockResolvedValueOnce({
      cliProvider: "claude",
      cliCustomCommand: "",
      model: "claude-opus-4-6",
      planModel: "",
      executeModel: "",
      maxBudgetUsd: 10,
      autoCommit: false,
      autoPush: false,
      planThinking: "basic",
      executeThinking: "smart",
      customTags: [],
      customInstructions: "",
      branchMode: "current" as const,
      branchName: "",
      maxConcurrentCards: 1,
    });

    // Reopen the dialog
    rerender(<CardDialog {...defaultProps} open={true} card={null} />);

    await waitFor(() => {
      // Should have fetched twice — once on first open, once on reopen
      expect(configApi.getForBoard).toHaveBeenCalledTimes(2);
    });

    // The "Normal" (basic) Plan checkbox must now be checked
    await waitFor(() => {
      const checkboxes = screen.getAllByRole("checkbox");
      const normalPlanCheckbox = checkboxes.find((cb) => {
        const label = cb.closest("label");
        return (
          label?.textContent?.includes("Normal") &&
          cb.closest(".flex.items-center.gap-2")?.querySelector(".w-11")?.textContent === "Plan"
        );
      });
      expect(normalPlanCheckbox).toBeDefined();
      expect(normalPlanCheckbox!).toBeChecked();
    });
  });

  it("shows card-level autoCommit=true override instead of config default false", async () => {
    vi.mocked(configApi.getForBoard).mockResolvedValue({
      cliProvider: "claude",
      cliCustomCommand: "",
      model: "claude-opus-4-6",
      planModel: "",
      executeModel: "",
      maxBudgetUsd: 10,

      autoCommit: false,
      autoPush: false,
      planThinking: "smart",
      executeThinking: "smart",
      customTags: [],
      customInstructions: "",
      branchMode: "current" as const,
      branchName: "",
      maxConcurrentCards: 1,
    });

    const cardWithOverride = {
      id: "card-1",
      board_id: "board-1",
      title: "Test card",
      description: "desc",
      status: "todo" as const,
      position: 0,
      blocking: false,
      plan_thinking: null,
      execute_thinking: null,
      auto_commit: true,
      auto_push: null,
      cli_provider: null,
      cli_custom_command: null,
      branch_mode: null,
      branch_name: null,
      assignee: "ai" as const,
      files: [],
      tags: [],
      created_at: "",
      updated_at: "",
    };

    render(<CardDialog {...defaultProps} card={cardWithOverride} />);

    await waitFor(() => {
      const autoCommitLabel = screen.getByText(/auto-commit/i);
      const autoCommitSwitch = autoCommitLabel.closest("div")?.querySelector('[role="switch"]');
      expect(autoCommitSwitch).toBeDefined();
      expect(autoCommitSwitch).toHaveAttribute("aria-checked", "true");
    });
  });
});

describe("CardDialog — Cmd/Ctrl+Enter shortcut", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls onCreate when Cmd/Ctrl+Enter is pressed in description textarea", async () => {
    vi.mocked(configApi.getForBoard).mockResolvedValue({
      cliProvider: "claude",
      cliCustomCommand: "",
      model: "claude-opus-4-6",
      planModel: "",
      executeModel: "",
      maxBudgetUsd: 10,
      autoCommit: false,
      autoPush: false,
      planThinking: "smart",
      executeThinking: "smart",
      customTags: [],
      customInstructions: "",
      branchMode: "current" as const,
      branchName: "",
      maxConcurrentCards: 1,
    });

    const onCreate = vi.fn(() => Promise.resolve());
    const onOpenChange = vi.fn();

    render(
      <CardDialog
        {...defaultProps}
        card={null}
        onCreate={onCreate}
        onOpenChange={onOpenChange}
      />
    );

    const textarea = screen.getByPlaceholderText("Describe what needs to be done...");
    fireEvent.change(textarea, { target: { value: "Test card description" } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ description: "Test card description" })
      );
    });
  });

  it("does not create card on Enter without Cmd/Ctrl", async () => {
    vi.mocked(configApi.getForBoard).mockResolvedValue({
      cliProvider: "claude",
      cliCustomCommand: "",
      model: "claude-opus-4-6",
      planModel: "",
      executeModel: "",
      maxBudgetUsd: 10,
      autoCommit: false,
      autoPush: false,
      planThinking: "smart",
      executeThinking: "smart",
      customTags: [],
      customInstructions: "",
      branchMode: "current" as const,
      branchName: "",
      maxConcurrentCards: 1,
    });

    const onCreate = vi.fn(() => Promise.resolve());

    render(<CardDialog {...defaultProps} card={null} onCreate={onCreate} />);

    const textarea = screen.getByPlaceholderText("Describe what needs to be done...");
    fireEvent.change(textarea, { target: { value: "Test card description" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    // Give it a tick to ensure nothing fires
    await new Promise((r) => setTimeout(r, 50));
    expect(onCreate).not.toHaveBeenCalled();
  });
});

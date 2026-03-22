import { render, screen, waitFor } from "@testing-library/react";
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
  boards: {
    list: vi.fn(() => Promise.resolve([])),
  },
  cards: {
    moveToBoard: vi.fn(() => Promise.resolve()),
  },
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
    });

    render(<CardDialog {...defaultProps} card={null} />);

    await waitFor(() => {
      const autoPushLabel = screen.getByText(/auto-push/i);
      const autoPushSwitch = autoPushLabel.closest("div")?.querySelector('[role="switch"]');
      expect(autoPushSwitch).toBeDefined();
      expect(autoPushSwitch).toHaveAttribute("aria-checked", "false");
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

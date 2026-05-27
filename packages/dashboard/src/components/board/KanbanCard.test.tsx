import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// Mock heavy deps before importing the component
vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => "" } },
}));

vi.mock("@/lib/cardLabel", () => ({
  cardLabel: (c: { title: string; description: string }) => c.title || c.description,
}));

vi.mock("@/hooks/use-executions", () => ({
  useExecutions: () => ({ executions: [] }),
}));

vi.mock("@/lib/api", () => ({
  parseFilesChanged: vi.fn(() => []),
}));

import { KanbanCard } from "./KanbanCard";
import type { CardWithTags } from "@/lib/api";

function makeCard(overrides: Partial<CardWithTags> = {}): CardWithTags {
  return {
    id: "card-1",
    board_id: "board-1",
    title: "Test card",
    description: "desc",
    status: "todo",
    position: 0,
    blocking: false,
    plan_thinking: null,
    execute_thinking: null,
    auto_commit: null,
    auto_push: null,
    cli_provider: null,
    cli_custom_command: null,
    branch_mode: null,
    branch_name: null,
    assignee: "ai",
    files: [],
    tags: [],
    criteria: [],
    plan_summary: null,
    completion_summary: null,
    blocker: null,
    session_state: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

const defaultCardProps = {
  onPlay: vi.fn(),
  onStop: vi.fn(),
  onClick: vi.fn(),
};

describe("KanbanCard — session_state badge", () => {
  it("shows 'Working' badge when session_state is 'working'", () => {
    render(
      <KanbanCard
        {...defaultCardProps}
        card={makeCard({ session_state: "working" })}
      />
    );
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.queryByText("Your turn")).not.toBeInTheDocument();
  });

  it("shows 'Your turn' badge when session_state is 'idle'", () => {
    render(
      <KanbanCard
        {...defaultCardProps}
        card={makeCard({ session_state: "idle" })}
      />
    );
    expect(screen.getByText("Your turn")).toBeInTheDocument();
    expect(screen.queryByText("Working")).not.toBeInTheDocument();
  });

  it("shows neither badge when session_state is null", () => {
    render(
      <KanbanCard
        {...defaultCardProps}
        card={makeCard({ session_state: null })}
      />
    );
    expect(screen.queryByText("Working")).not.toBeInTheDocument();
    expect(screen.queryByText("Your turn")).not.toBeInTheDocument();
  });
});

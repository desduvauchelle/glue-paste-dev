import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CriteriaList } from "./CriteriaList";
import type { Criterion } from "@/lib/api";

const make = (over: Partial<Criterion>): Criterion => ({
  id: "c1",
  card_id: "card1",
  text: "App builds",
  status: "pending",
  source: "ai",
  evidence: null,
  execution_id: null,
  position: 0,
  created_at: "",
  updated_at: "",
  ...over,
});

describe("CriteriaList", () => {
  it("renders criteria with status and evidence", () => {
    render(
      <CriteriaList
        criteria={[make({ status: "pass", evidence: "tests green" })]}
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
        onJumpToExecution={vi.fn()}
      />
    );
    expect(screen.getByText("App builds")).toBeInTheDocument();
    expect(screen.getByText("tests green")).toBeInTheDocument();
  });

  it("calls onRemove when delete clicked", () => {
    const onRemove = vi.fn();
    render(
      <CriteriaList criteria={[make({})]} onAdd={vi.fn()} onUpdate={vi.fn()} onRemove={onRemove} onJumpToExecution={vi.fn()} />
    );
    fireEvent.click(screen.getByLabelText("Remove criterion"));
    expect(onRemove).toHaveBeenCalledWith("c1");
  });

  it("shows an empty state with no criteria", () => {
    render(<CriteriaList criteria={[]} onAdd={vi.fn()} onUpdate={vi.fn()} onRemove={vi.fn()} onJumpToExecution={vi.fn()} />);
    expect(screen.getByText(/no criteria yet/i)).toBeInTheDocument();
  });
});

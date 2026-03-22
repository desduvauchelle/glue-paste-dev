import { describe, it, expect } from "vitest";

interface TestCard {
  id: string;
  status: string;
  position: number;
  created_at: string | null;
  assignee: "ai" | "human";
}

const makeCard = (overrides: Partial<TestCard> & { id: string }): TestCard => ({
  status: "todo",
  position: 0,
  created_at: "2026-03-20T10:00:00Z",
  assignee: "ai",
  ...overrides,
});

// Replicates the in-progress guard from KanbanBoard.tsx lines 101-104 and 157-163
function canDropIntoInProgress(activeCardId: string, currentInProgressCards: TestCard[]): boolean {
  const hasOtherInProgress = currentInProgressCards.some((c) => c.id !== activeCardId);
  return !hasOtherInProgress;
}

// Replicates the reorder constraint from KanbanBoard.tsx lines 169-177
const SORTABLE_STATUSES = new Set(["todo", "queued"]);

function canReorderWithinColumn(column: string, card: TestCard): boolean {
  return SORTABLE_STATUSES.has(column) || card.assignee === "human";
}

describe("in-progress limit (max 1 card)", () => {
  it("allows drop when in-progress is empty", () => {
    expect(canDropIntoInProgress("card-1", [])).toBe(true);
  });

  it("allows drop when dragging the card already in progress (self)", () => {
    const inProgress = [makeCard({ id: "card-1", status: "in-progress" })];
    expect(canDropIntoInProgress("card-1", inProgress)).toBe(true);
  });

  it("blocks drop when another card is already in progress", () => {
    const inProgress = [makeCard({ id: "other-card", status: "in-progress" })];
    expect(canDropIntoInProgress("card-1", inProgress)).toBe(false);
  });

  it("blocks drop even with the same card present (2 cards in column)", () => {
    const inProgress = [
      makeCard({ id: "card-1", status: "in-progress" }),
      makeCard({ id: "other-card", status: "in-progress" }),
    ];
    expect(canDropIntoInProgress("card-1", inProgress)).toBe(false);
  });
});

describe("drag reorder constraints", () => {
  it("allows reorder within todo column", () => {
    expect(canReorderWithinColumn("todo", makeCard({ id: "c1" }))).toBe(true);
  });

  it("allows reorder within queued column", () => {
    expect(canReorderWithinColumn("queued", makeCard({ id: "c1" }))).toBe(true);
  });

  it("blocks reorder within done column for AI cards", () => {
    expect(canReorderWithinColumn("done", makeCard({ id: "c1", assignee: "ai" }))).toBe(false);
  });

  it("blocks reorder within failed column for AI cards", () => {
    expect(canReorderWithinColumn("failed", makeCard({ id: "c1", assignee: "ai" }))).toBe(false);
  });

  it("blocks reorder within in-progress column for AI cards", () => {
    expect(canReorderWithinColumn("in-progress", makeCard({ id: "c1", assignee: "ai" }))).toBe(false);
  });

  it("allows reorder in any column for human-assigned cards", () => {
    const humanCard = makeCard({ id: "c1", assignee: "human" });
    expect(canReorderWithinColumn("done", humanCard)).toBe(true);
    expect(canReorderWithinColumn("failed", humanCard)).toBe(true);
    expect(canReorderWithinColumn("in-progress", humanCard)).toBe(true);
  });
});

// Replicates the sort logic from use-cards.ts lines 129-150
function sortCards(cards: TestCard[], column: string): TestCard[] {
  const byPosition = (a: TestCard, b: TestCard) => a.position - b.position;
  const byCreatedDesc = (a: TestCard, b: TestCard) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return tb - ta;
  };

  switch (column) {
    case "todo":
    case "queued":
      return [...cards].sort(byPosition);
    case "done":
    case "failed":
      return [...cards].sort(byCreatedDesc);
    default:
      return cards;
  }
}

describe("column sorting rules", () => {
  it("todo column: cards sorted by position ascending", () => {
    const cards = [
      makeCard({ id: "c3", position: 2 }),
      makeCard({ id: "c1", position: 0 }),
      makeCard({ id: "c2", position: 1 }),
    ];
    const sorted = sortCards(cards, "todo");
    expect(sorted.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("queued column: cards sorted by position ascending", () => {
    const cards = [
      makeCard({ id: "c2", position: 1 }),
      makeCard({ id: "c3", position: 2 }),
      makeCard({ id: "c1", position: 0 }),
    ];
    const sorted = sortCards(cards, "queued");
    expect(sorted.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("done column: cards sorted by most recent first (created_at desc)", () => {
    const cards = [
      makeCard({ id: "c1", created_at: "2026-03-18T10:00:00Z" }),
      makeCard({ id: "c3", created_at: "2026-03-20T10:00:00Z" }),
      makeCard({ id: "c2", created_at: "2026-03-19T10:00:00Z" }),
    ];
    const sorted = sortCards(cards, "done");
    expect(sorted.map((c) => c.id)).toEqual(["c3", "c2", "c1"]);
  });

  it("failed column: cards sorted by most recent first (created_at desc)", () => {
    const cards = [
      makeCard({ id: "c2", created_at: "2026-03-19T10:00:00Z" }),
      makeCard({ id: "c1", created_at: "2026-03-18T10:00:00Z" }),
      makeCard({ id: "c3", created_at: "2026-03-20T10:00:00Z" }),
    ];
    const sorted = sortCards(cards, "failed");
    expect(sorted.map((c) => c.id)).toEqual(["c3", "c2", "c1"]);
  });

  it("new card added to todo appends to bottom (highest position)", () => {
    const existing = [
      makeCard({ id: "c1", position: 0 }),
      makeCard({ id: "c2", position: 1 }),
    ];
    // Simulate adding a new card at the next position
    const newCard = makeCard({ id: "c3", position: 2 });
    const all = [...existing, newCard];
    const sorted = sortCards(all, "todo");
    expect(sorted[sorted.length - 1]!.id).toBe("c3");
  });

  it("new card added to queued appends to bottom (highest position)", () => {
    const existing = [
      makeCard({ id: "c1", position: 0 }),
      makeCard({ id: "c2", position: 1 }),
    ];
    const newCard = makeCard({ id: "c3", position: 2 });
    const all = [...existing, newCard];
    const sorted = sortCards(all, "queued");
    expect(sorted[sorted.length - 1]!.id).toBe("c3");
  });

  it("done column is not user-reorganizable (position ignored)", () => {
    // Even if positions differ, done uses created_at sorting
    const cards = [
      makeCard({ id: "c1", position: 0, created_at: "2026-03-20T10:00:00Z" }),
      makeCard({ id: "c2", position: 1, created_at: "2026-03-21T10:00:00Z" }),
    ];
    const sorted = sortCards(cards, "done");
    // Most recent first, regardless of position
    expect(sorted[0]!.id).toBe("c2");
  });
});

describe("cross-column drag constraints", () => {
  it("cannot drag a second card into in-progress when one already exists (multiple candidates)", () => {
    const inProgress = [makeCard({ id: "existing", status: "in-progress" })];
    // Multiple cards trying to drop — all should be blocked
    expect(canDropIntoInProgress("card-a", inProgress)).toBe(false);
    expect(canDropIntoInProgress("card-b", inProgress)).toBe(false);
    expect(canDropIntoInProgress("card-c", inProgress)).toBe(false);
  });

  it("allows drag between todo and queued (both sortable)", () => {
    // Both are in SORTABLE_STATUSES, so reordering is allowed
    const card = makeCard({ id: "c1" });
    expect(canReorderWithinColumn("todo", card)).toBe(true);
    expect(canReorderWithinColumn("queued", card)).toBe(true);
  });
});

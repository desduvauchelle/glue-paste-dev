import { describe, it, expect } from "vitest";

function sortByPosition(cards: Array<{ position: number }>) {
  return [...cards].sort((a, b) => a.position - b.position);
}

function sortByCreatedAsc(cards: Array<{ created_at: string | null }>) {
  return [...cards].sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return ta - tb;
  });
}

function sortByCreatedDesc(cards: Array<{ created_at: string | null }>) {
  return [...cards].sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return tb - ta;
  });
}

describe("card grouping sort orders", () => {
  it("sorts todo/queued by position ascending", () => {
    const cards = [
      { position: 2 },
      { position: 0 },
      { position: 1 },
    ];
    const sorted = sortByPosition(cards);
    expect(sorted.map((c) => c.position)).toEqual([0, 1, 2]);
  });

  it("sorts in-progress by created_at ascending (oldest first)", () => {
    const cards = [
      { created_at: "2026-03-19T10:00:00Z" },
      { created_at: "2026-03-18T10:00:00Z" },
      { created_at: "2026-03-19T08:00:00Z" },
    ];
    const sorted = sortByCreatedAsc(cards);
    expect(sorted[0]!.created_at).toBe("2026-03-18T10:00:00Z");
    expect(sorted[2]!.created_at).toBe("2026-03-19T10:00:00Z");
  });

  it("sorts done/failed by created_at descending (newest first)", () => {
    const cards = [
      { created_at: "2026-03-18T10:00:00Z" },
      { created_at: "2026-03-19T10:00:00Z" },
      { created_at: "2026-03-17T10:00:00Z" },
    ];
    const sorted = sortByCreatedDesc(cards);
    expect(sorted[0]!.created_at).toBe("2026-03-19T10:00:00Z");
    expect(sorted[2]!.created_at).toBe("2026-03-17T10:00:00Z");
  });

  it("handles null created_at values", () => {
    const cards = [
      { created_at: "2026-03-19T10:00:00Z" },
      { created_at: null },
      { created_at: "2026-03-18T10:00:00Z" },
    ];
    const sorted = sortByCreatedDesc(cards);
    expect(sorted[0]!.created_at).toBe("2026-03-19T10:00:00Z");
    expect(sorted[2]!.created_at).toBeNull();
  });
});

describe("sort mode helpers", () => {
  it("sortByUpdatedDesc sorts newest first", () => {
    const cards = [
      { updated_at: "2026-03-19T10:00:00Z", title: "B" },
      { updated_at: "2026-03-21T10:00:00Z", title: "A" },
      { updated_at: "2026-03-20T10:00:00Z", title: "C" },
    ];
    const sorted = [...cards].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
    expect(sorted[0]!.title).toBe("A");
    expect(sorted[2]!.title).toBe("B");
  });

  it("sortByTitleAsc sorts alphabetically", () => {
    const cards = [
      { title: "Banana", updated_at: "2026-03-20T10:00:00Z" },
      { title: "Apple",  updated_at: "2026-03-21T10:00:00Z" },
      { title: "Cherry", updated_at: "2026-03-19T10:00:00Z" },
    ];
    const sorted = [...cards].sort((a, b) => a.title.localeCompare(b.title));
    expect(sorted[0]!.title).toBe("Apple");
    expect(sorted[2]!.title).toBe("Cherry");
  });
});

describe("groupCards with sortMode", () => {
  const makeCard = (overrides: Partial<{
    id: string; status: string; position: number;
    title: string; updated_at: string;
  }>) => ({
    id: "1", status: "todo", position: 0,
    title: "Card", updated_at: "2026-03-21T10:00:00Z",
    ...overrides,
  });

  function groupCards(
    cards: ReturnType<typeof makeCard>[],
    sortMode: "custom" | "recent" | "alpha"
  ) {
    const byPosition = (a: typeof cards[0], b: typeof cards[0]) =>
      a.position - b.position;
    const byUpdatedDesc = (a: typeof cards[0], b: typeof cards[0]) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    const byTitleAsc = (a: typeof cards[0], b: typeof cards[0]) =>
      a.title.localeCompare(b.title);

    const todoSorter =
      sortMode === "custom" ? byPosition :
      sortMode === "recent" ? byUpdatedDesc :
      byTitleAsc;

    return {
      todo: cards.filter((c) => c.status === "todo").sort(todoSorter),
    };
  }

  it("custom mode: sorts todo by position", () => {
    const cards = [
      makeCard({ id: "a", position: 2, title: "B", updated_at: "2026-03-20T10:00:00Z" }),
      makeCard({ id: "b", position: 0, title: "A", updated_at: "2026-03-21T10:00:00Z" }),
      makeCard({ id: "c", position: 1, title: "C", updated_at: "2026-03-19T10:00:00Z" }),
    ];
    const grouped = groupCards(cards, "custom");
    expect(grouped.todo.map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  it("recent mode: sorts todo by updated_at descending", () => {
    const cards = [
      makeCard({ id: "a", position: 0, title: "B", updated_at: "2026-03-19T10:00:00Z" }),
      makeCard({ id: "b", position: 1, title: "A", updated_at: "2026-03-21T10:00:00Z" }),
      makeCard({ id: "c", position: 2, title: "C", updated_at: "2026-03-20T10:00:00Z" }),
    ];
    const grouped = groupCards(cards, "recent");
    expect(grouped.todo.map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  it("alpha mode: sorts todo by title ascending", () => {
    const cards = [
      makeCard({ id: "a", position: 0, title: "Banana", updated_at: "2026-03-20T10:00:00Z" }),
      makeCard({ id: "b", position: 1, title: "Apple",  updated_at: "2026-03-21T10:00:00Z" }),
      makeCard({ id: "c", position: 2, title: "Cherry", updated_at: "2026-03-19T10:00:00Z" }),
    ];
    const grouped = groupCards(cards, "alpha");
    expect(grouped.todo.map((c) => c.id)).toEqual(["b", "a", "c"]);
  });
});

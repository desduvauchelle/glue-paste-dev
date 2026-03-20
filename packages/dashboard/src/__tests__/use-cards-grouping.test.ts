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

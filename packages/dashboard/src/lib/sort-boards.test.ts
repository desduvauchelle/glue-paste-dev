import { describe, it, expect, beforeEach, vi } from "vitest";
import { readSortMode, readCustomOrder, sortBoards } from "./sort-boards";

const mockBoards = [
  { id: "b1", name: "Zebra", updated_at: "2026-01-01T00:00:00Z" },
  { id: "b2", name: "Alpha", updated_at: "2026-03-01T00:00:00Z" },
  { id: "b3", name: "Middle", updated_at: "2026-02-01T00:00:00Z" },
] as Parameters<typeof sortBoards>[0];

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
});

describe("readSortMode", () => {

  it("defaults to 'recent' when nothing stored", () => {
    expect(readSortMode()).toBe("recent");
  });

  it("reads valid value from localStorage", () => {
    localStorage.setItem("glue-board-sort", "alpha");
    expect(readSortMode()).toBe("alpha");
  });

  it("returns 'recent' for invalid values", () => {
    localStorage.setItem("glue-board-sort", "invalid");
    expect(readSortMode()).toBe("recent");
  });
});

describe("readCustomOrder", () => {

  it("returns empty array when nothing stored", () => {
    expect(readCustomOrder()).toEqual([]);
  });

  it("reads stored order", () => {
    localStorage.setItem("glue-board-order", JSON.stringify(["b2", "b1"]));
    expect(readCustomOrder()).toEqual(["b2", "b1"]);
  });

  it("returns empty array for invalid JSON", () => {
    localStorage.setItem("glue-board-order", "not-json");
    expect(readCustomOrder()).toEqual([]);
  });
});

describe("sortBoards", () => {
  it("sorts alphabetically in alpha mode", () => {
    const result = sortBoards(mockBoards, "alpha", []);
    expect(result.map((b) => b.name)).toEqual(["Alpha", "Middle", "Zebra"]);
  });

  it("sorts by most recent in recent mode", () => {
    const result = sortBoards(mockBoards, "recent", []);
    expect(result.map((b) => b.id)).toEqual(["b2", "b3", "b1"]);
  });

  it("sorts by custom order", () => {
    const result = sortBoards(mockBoards, "custom", ["b3", "b1", "b2"]);
    expect(result.map((b) => b.id)).toEqual(["b3", "b1", "b2"]);
  });

  it("puts unlisted boards at end in custom mode", () => {
    const result = sortBoards(mockBoards, "custom", ["b2"]);
    expect(result[0]!.id).toBe("b2");
  });
});

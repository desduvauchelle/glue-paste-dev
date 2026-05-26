import { describe, it, expect } from "vitest";
import { sessionsToKillOnReorder } from "@/pages/BoardView";

interface MinimalCard {
  id: string;
  session_state: "working" | "idle" | null;
}

describe("sessionsToKillOnReorder", () => {
  const cards: MinimalCard[] = [
    { id: "a", session_state: "working" },
    { id: "b", session_state: "idle" },
    { id: "c", session_state: null },
    { id: "d", session_state: "working" },
  ];

  it("kills session for card with session_state='working' dragged to done", () => {
    const ids = sessionsToKillOnReorder(
      [{ id: "a", status: "done", position: 0 }],
      cards
    );
    expect(ids).toEqual(["a"]);
  });

  it("kills session for card with session_state='idle' dragged to done", () => {
    const ids = sessionsToKillOnReorder(
      [{ id: "b", status: "done", position: 0 }],
      cards
    );
    expect(ids).toEqual(["b"]);
  });

  it("kills session for card dragged to todo", () => {
    const ids = sessionsToKillOnReorder(
      [{ id: "a", status: "todo", position: 0 }],
      cards
    );
    expect(ids).toEqual(["a"]);
  });

  it("kills session for card dragged to queued", () => {
    const ids = sessionsToKillOnReorder(
      [{ id: "a", status: "queued", position: 0 }],
      cards
    );
    expect(ids).toEqual(["a"]);
  });

  it("does NOT kill session for card with session_state=null dragged to done", () => {
    const ids = sessionsToKillOnReorder(
      [{ id: "c", status: "done", position: 0 }],
      cards
    );
    expect(ids).toEqual([]);
  });

  it("does NOT kill session for card dragged to in-progress", () => {
    const ids = sessionsToKillOnReorder(
      [{ id: "a", status: "in-progress", position: 0 }],
      cards
    );
    expect(ids).toEqual([]);
  });

  it("collects multiple cards with live sessions dragged to done/todo/queued", () => {
    const ids = sessionsToKillOnReorder(
      [
        { id: "a", status: "done", position: 0 },
        { id: "d", status: "todo", position: 1 },
      ],
      cards
    );
    expect(ids).toEqual(["a", "d"]);
  });

  it("skips cards whose id is not found in cards list", () => {
    const ids = sessionsToKillOnReorder(
      [{ id: "unknown", status: "done", position: 0 }],
      cards
    );
    expect(ids).toEqual([]);
  });
});

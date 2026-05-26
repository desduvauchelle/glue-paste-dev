import { describe, it, expect, mock } from "bun:test";
import { getTestDb, boardsDb, cardsDb } from "@glue-paste-dev/core";
import type { Database } from "bun:sqlite";

/**
 * Tests that terminal-hub-singleton wires the onIdle/onBusy broadcasts correctly
 * and persists session_state to the database.
 *
 * The module has a module-level singleton cache (`let hub`), so we test the
 * callback wiring by intercepting `createTerminalHub` from core and capturing
 * the callbacks it receives. We then call those callbacks directly to confirm
 * they fire the expected broadcasts and DB mutations.
 *
 * Note on singleton + db closure: the hub is created once; the `broadcast` and
 * `db` captured in the callbacks are from the FIRST `getTerminalHub` call. Both
 * tests share the same `events` array and `db` to reflect that reality.
 */

let capturedOnIdle: ((cardId: string) => void) | undefined;
let capturedOnBusy: ((cardId: string) => void) | undefined;

// Shared broadcast events array — the hub is created once, so all callbacks
// share the same broadcast reference captured at creation.
const events: unknown[] = [];
const broadcast = (e: unknown) => events.push(e);

// Shared db — same reasoning: created once, captured in hub closure.
const db: Database = getTestDb();
const board = boardsDb.createBoard(db, {
  name: "Test Board",
  description: "",
  directory: "/tmp/test",
});

// Mock createTerminalHub BEFORE importing the module under test so the mock
// is in place when getTerminalHub first creates the hub.
mock.module("@glue-paste-dev/core", () => {
  // Spread the real core so cardsDb / boardsDb / getTestDb still work inside callbacks.
  const real = require("@glue-paste-dev/core");
  return {
    ...real,
    createTerminalHub: (args: {
      permissionMode: string;
      command: string[];
      onOutput: (cardId: string, data: string) => void;
      onExit: (cardId: string, code: number) => void;
      onIdle?: (cardId: string) => void;
      onBusy?: (cardId: string) => void;
      maxSessions?: number;
    }) => {
      capturedOnIdle = args.onIdle;
      capturedOnBusy = args.onBusy;
      return {
        open: mock(() => {}),
        isRunning: mock(() => false),
        getScrollback: mock(() => ""),
        close: mock(() => {}),
        interrupt: mock(() => {}),
        closeAll: mock(() => {}),
        attach: mock(() => {}),
        detach: mock(() => {}),
        heartbeat: mock(() => {}),
        input: mock(() => {}),
        resize: mock(() => {}),
        detachClientEverywhere: mock(() => {}),
      };
    },
  };
});

import { getTerminalHub } from "../terminal-hub-singleton.js";

describe("terminal-hub-singleton onIdle/onBusy broadcast wiring", () => {
  it("passes onIdle to createTerminalHub; onIdle broadcasts execution:idle + card:updated and sets session_state=idle", () => {
    const card = cardsDb.createCard(db, board.id as any, {
      title: "Test Card Idle",
      description: "desc",
      tags: [],
    });
    const cardId = card.id;

    events.length = 0;

    // First call — creates the hub, captures callbacks.
    getTerminalHub(broadcast, "auto-unless-watching", db);

    expect(capturedOnIdle).toBeDefined();

    capturedOnIdle!(cardId);

    // Must broadcast execution:idle
    expect(events).toContainEqual({ type: "execution:idle", payload: { cardId } });
    // Must broadcast card:updated
    const cardUpdatedEvent = events.find(
      (e) => (e as { type: string }).type === "card:updated"
    ) as { type: string; payload: { id: string } } | undefined;
    expect(cardUpdatedEvent).toBeDefined();
    expect(cardUpdatedEvent!.payload.id).toBe(cardId);

    // DB must reflect session_state = "idle"
    const updatedCard = cardsDb.getCard(db, cardId as any);
    expect(updatedCard?.session_state).toBe("idle");
  });

  it("passes onBusy to createTerminalHub; onBusy broadcasts card:updated and sets session_state=working", () => {
    const card = cardsDb.createCard(db, board.id as any, {
      title: "Test Card Busy",
      description: "desc",
      tags: [],
    });
    const cardId = card.id;

    events.length = 0;

    // Hub already cached — callbacks still refer to the shared broadcast/db.
    getTerminalHub(broadcast, "auto-unless-watching", db);

    expect(capturedOnBusy).toBeDefined();

    capturedOnBusy!(cardId);

    // Must broadcast card:updated
    const cardUpdatedEvent = events.find(
      (e) => (e as { type: string }).type === "card:updated"
    ) as { type: string; payload: { id: string } } | undefined;
    expect(cardUpdatedEvent).toBeDefined();
    expect(cardUpdatedEvent!.payload.id).toBe(cardId);

    // DB must reflect session_state = "working"
    const updatedCard = cardsDb.getCard(db, cardId as any);
    expect(updatedCard?.session_state).toBe("working");
  });
});

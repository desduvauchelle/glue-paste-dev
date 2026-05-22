import { describe, it, expect, mock } from "bun:test";

/**
 * Tests that terminal-hub-singleton wires the onIdle broadcast correctly.
 *
 * The module has a module-level singleton cache (`let hub`), so we test the
 * onIdle wiring by intercepting `createTerminalHub` from core and capturing
 * the `onIdle` callback it receives. We then call that callback directly to
 * confirm it fires a `{ type: "execution:idle", payload: { cardId } }` broadcast.
 */

let capturedOnIdle: ((cardId: string) => void) | undefined;

// Mock createTerminalHub BEFORE importing the module under test so the mock
// is in place when getTerminalHub first creates the hub.
mock.module("@glue-paste-dev/core", () => ({
  createTerminalHub: (args: {
    permissionMode: string;
    command: string[];
    onOutput: (cardId: string, data: string) => void;
    onExit: (cardId: string, code: number) => void;
    onIdle?: (cardId: string) => void;
  }) => {
    capturedOnIdle = args.onIdle;
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
}));

import { getTerminalHub } from "../terminal-hub-singleton.js";

describe("terminal-hub-singleton onIdle broadcast wiring", () => {
  it("passes onIdle to createTerminalHub and onIdle broadcasts execution:idle", () => {
    const events: unknown[] = [];
    const broadcast = (e: unknown) => events.push(e);

    // Call getTerminalHub to trigger hub creation (or retrieve the cached one).
    // In this test's module scope the mock is fresh so it will create a new hub.
    getTerminalHub(broadcast, "auto-unless-watching");

    // The onIdle callback must have been captured by the mock.
    expect(capturedOnIdle).toBeDefined();

    // Simulate hub firing the idle event for a card.
    capturedOnIdle!("card-abc");

    expect(events).toEqual([
      { type: "execution:idle", payload: { cardId: "card-abc" } },
    ]);
  });
});

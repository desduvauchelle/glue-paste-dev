import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mock @tauri-apps/api/event and @tauri-apps/api/core before any ws import
// ---------------------------------------------------------------------------

type TauriListener = (event: { payload: unknown }) => void;
const tauriListeners = new Map<string, TauriListener[]>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((evtType: string, handler: TauriListener) => {
    if (!tauriListeners.has(evtType)) tauriListeners.set(evtType, []);
    tauriListeners.get(evtType)!.push(handler);
    const unlisten = () => {
      const arr = tauriListeners.get(evtType);
      if (arr) {
        const idx = arr.indexOf(handler);
        if (idx !== -1) arr.splice(idx, 1);
      }
    };
    return Promise.resolve(unlisten);
  }),
}));

const mockInvoke = vi.fn((_cmd: string, _args?: unknown) => Promise.resolve(undefined));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => mockInvoke(cmd, args),
}));

/** Simulate a Tauri event emission */
function emitTauri(evtType: string, payload: unknown) {
  const handlers = tauriListeners.get(evtType) ?? [];
  for (const h of handlers) h({ payload });
}

beforeEach(() => {
  tauriListeners.clear();
  mockInvoke.mockClear();
  // Reset module so bridgeStarted resets between tests
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useWebSocket", () => {
  it("calls listener when a Tauri event is emitted", async () => {
    const { useWebSocket } = await import("../lib/ws.js");
    const handler = vi.fn();

    renderHook(() => useWebSocket(handler));

    // Wait for the listen() promises to resolve
    await act(async () => {
      await Promise.resolve();
    });

    emitTauri("card:updated", { id: "c1" });

    expect(handler).toHaveBeenCalledWith({ type: "card:updated", payload: { id: "c1" } });
  });

  it("does not call listener after unsubscribe", async () => {
    const { useWebSocket } = await import("../lib/ws.js");
    const handler = vi.fn();

    const { unmount } = renderHook(() => useWebSocket(handler));

    await act(async () => {
      await Promise.resolve();
    });

    unmount();
    emitTauri("card:updated", { id: "c1" });

    expect(handler).not.toHaveBeenCalled();
  });
});

describe("useWSEvent", () => {
  it("only fires handler for matching event type", async () => {
    const { useWSEvent } = await import("../lib/ws.js");
    const handler = vi.fn();

    renderHook(() => useWSEvent("card:updated", handler));

    await act(async () => {
      await Promise.resolve();
    });

    emitTauri("execution:started", { run: 1 });
    expect(handler).not.toHaveBeenCalled();

    emitTauri("card:updated", { id: "c1" });
    expect(handler).toHaveBeenCalledWith({ id: "c1" });
  });
});

describe("sendWS", () => {
  it("returns false for non-terminal messages", async () => {
    const { sendWS } = await import("../lib/ws.js");
    expect(sendWS({ type: "board:refresh" })).toBe(false);
  });

  it("returns false for terminal messages without a cardId", async () => {
    const { sendWS } = await import("../lib/ws.js");
    expect(sendWS({ type: "terminal:input", data: "x" })).toBe(false);
  });

  it("invokes terminal_input and returns true for terminal:input", async () => {
    const { sendWS } = await import("../lib/ws.js");
    const result = sendWS({ type: "terminal:input", cardId: "c1", data: "ls\n" });
    expect(result).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("terminal_input", { cardId: "c1", data: "ls\n" });
  });

  it("invokes terminal_resize and returns true for terminal:resize", async () => {
    const { sendWS } = await import("../lib/ws.js");
    const result = sendWS({ type: "terminal:resize", cardId: "c1", cols: 120, rows: 40 });
    expect(result).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("terminal_resize", { cardId: "c1", cols: 120, rows: 40 });
  });

  it("returns false for unknown terminal sub-types", async () => {
    const { sendWS } = await import("../lib/ws.js");
    expect(sendWS({ type: "terminal:unknown", cardId: "c1" })).toBe(false);
  });
});

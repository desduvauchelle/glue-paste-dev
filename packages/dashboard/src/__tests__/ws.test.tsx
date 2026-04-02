import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  close = vi.fn();

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  simulateOpen() {
    this.readyState = 1;
    this.onopen?.();
  }

  simulateMessage(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateClose(code = 1000, reason = "") {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("useWebSocket", () => {
  it("calls listener when a message is received", async () => {
    const { useWebSocket } = await import("../lib/ws.js");
    const handler = vi.fn();

    renderHook(() => useWebSocket(handler));

    const ws = MockWebSocket.instances[0]!;
    expect(ws).toBeDefined();

    ws.simulateOpen();
    ws.simulateMessage({ type: "test:event", payload: { foo: 1 } });

    expect(handler).toHaveBeenCalledWith({ type: "test:event", payload: { foo: 1 } });
  });

  it("creates WebSocket connection on first subscriber", async () => {
    const { useWebSocket } = await import("../lib/ws.js");

    renderHook(() => useWebSocket(vi.fn()));

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]!.url).toContain("/ws");
  });
});

describe("useWSEvent", () => {
  it("only fires handler for matching event type", async () => {
    const { useWSEvent } = await import("../lib/ws.js");
    const handler = vi.fn();

    renderHook(() => useWSEvent("card:updated", handler));

    const ws = MockWebSocket.instances[0]!;
    ws.simulateOpen();

    ws.simulateMessage({ type: "board:updated", payload: {} });
    expect(handler).not.toHaveBeenCalled();

    ws.simulateMessage({ type: "card:updated", payload: { id: "c1" } });
    expect(handler).toHaveBeenCalledWith({ id: "c1" });
  });
});

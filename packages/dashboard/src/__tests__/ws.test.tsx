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
  send = vi.fn();

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

describe("sendWS", () => {
  it("returns false when there is no open socket", async () => {
    const { sendWS } = await import("../lib/ws.js");
    // No connection has been established — ws is null
    expect(sendWS({ type: "terminal:input", cardId: "c1", data: "x" })).toBe(false);
  });

  it("returns true and calls socket.send with JSON string when socket is open", async () => {
    const { useWebSocket, sendWS } = await import("../lib/ws.js");

    // Establish a connection via the hook
    renderHook(() => useWebSocket(vi.fn()));

    const mockWs = MockWebSocket.instances[0]!;
    expect(mockWs).toBeDefined();

    // Simulate the socket becoming open
    mockWs.simulateOpen();

    const msg = { type: "terminal:input", cardId: "c1", data: "x" };
    const result = sendWS(msg);

    expect(result).toBe(true);
    expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify(msg));
  });

  it("returns false when socket exists but is not OPEN (e.g. CONNECTING)", async () => {
    const { useWebSocket, sendWS } = await import("../lib/ws.js");

    renderHook(() => useWebSocket(vi.fn()));

    const mockWs = MockWebSocket.instances[0]!;
    // readyState is 0 (CONNECTING) by default — never called simulateOpen
    expect(mockWs.readyState).toBe(0);

    expect(sendWS({ type: "terminal:input", cardId: "c1", data: "x" })).toBe(false);
    expect(mockWs.send).not.toHaveBeenCalled();
  });
});

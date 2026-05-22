import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("@/lib/api", () => ({
  terminal: {
    open: vi.fn().mockResolvedValue({ ok: true, running: true }),
    status: vi.fn().mockResolvedValue({ running: true, scrollback: "" }),
    close: vi.fn(),
    stop: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

let wsHandler: ((event: { type: string; payload: unknown }) => void) | undefined;

vi.mock("@/lib/ws", () => ({
  sendWS: vi.fn(),
  useWebSocket: vi.fn((cb: (event: { type: string; payload: unknown }) => void) => {
    wsHandler = cb;
  }),
}));

import { useTerminal } from "./use-terminal";
import { terminal as terminalApi } from "@/lib/api";
import { sendWS } from "@/lib/ws";

beforeEach(() => {
  vi.clearAllMocks();
  wsHandler = undefined;
  vi.mocked(terminalApi.open).mockResolvedValue({ ok: true, running: true });
  vi.mocked(terminalApi.status).mockResolvedValue({ running: true, scrollback: "" });
  vi.mocked(terminalApi.stop).mockResolvedValue({ ok: true });
});

describe("useTerminal", () => {
  it("opens the terminal with 80x24 when active", async () => {
    renderHook(() =>
      useTerminal({ cardId: "card-1", active: true, onData: () => {} })
    );
    await waitFor(() => {
      expect(terminalApi.open).toHaveBeenCalledWith("card-1", { cols: 80, rows: 24 });
    });
  });

  it("sends a heartbeat while visible and active", async () => {
    renderHook(() =>
      useTerminal({ cardId: "card-1", active: true, onData: () => {} })
    );
    await waitFor(() => {
      expect(sendWS).toHaveBeenCalledWith({ type: "terminal:heartbeat", cardId: "card-1" });
    });
  });

  it("sends an attach message after opening", async () => {
    renderHook(() =>
      useTerminal({ cardId: "card-1", active: true, onData: () => {} })
    );
    await waitFor(() => {
      expect(sendWS).toHaveBeenCalledWith({ type: "terminal:attach", cardId: "card-1" });
    });
  });

  it("replays scrollback via onData", async () => {
    vi.mocked(terminalApi.status).mockResolvedValue({ running: true, scrollback: "hello" });
    const onData = vi.fn();
    renderHook(() => useTerminal({ cardId: "card-1", active: true, onData }));
    await waitFor(() => {
      expect(onData).toHaveBeenCalledWith("hello");
    });
  });

  it("sendInput sends a terminal:input message", () => {
    const { result } = renderHook(() =>
      useTerminal({ cardId: "card-1", active: false, onData: () => {} })
    );
    result.current.sendInput("x");
    expect(sendWS).toHaveBeenCalledWith({ type: "terminal:input", cardId: "card-1", data: "x" });
  });

  it("sendResize sends a terminal:resize message", () => {
    const { result } = renderHook(() =>
      useTerminal({ cardId: "card-1", active: false, onData: () => {} })
    );
    result.current.sendResize(120, 40);
    expect(sendWS).toHaveBeenCalledWith({
      type: "terminal:resize",
      cardId: "card-1",
      cols: 120,
      rows: 40,
    });
  });

  it("detaches on unmount when active", async () => {
    const { unmount } = renderHook(() =>
      useTerminal({ cardId: "card-1", active: true, onData: () => {} })
    );
    await waitFor(() => {
      expect(terminalApi.open).toHaveBeenCalled();
    });
    unmount();
    expect(sendWS).toHaveBeenCalledWith({ type: "terminal:detach", cardId: "card-1" });
  });

  it("does not open the terminal when inactive", () => {
    renderHook(() =>
      useTerminal({ cardId: "card-1", active: false, onData: () => {} })
    );
    expect(terminalApi.open).not.toHaveBeenCalled();
  });

  it("working starts as false", () => {
    const { result } = renderHook(() =>
      useTerminal({ cardId: "card-1", active: false, onData: () => {} })
    );
    expect(result.current.working).toBe(false);
  });

  it("sets working=true on execution:started for this card", () => {
    const { result } = renderHook(() =>
      useTerminal({ cardId: "card-1", active: false, onData: () => {} })
    );
    act(() => {
      wsHandler?.({ type: "execution:started", payload: { cardId: "card-1", executionId: "e1", phase: "run" } });
    });
    expect(result.current.working).toBe(true);
  });

  it("sets working=false on execution:idle for this card", () => {
    const { result } = renderHook(() =>
      useTerminal({ cardId: "card-1", active: false, onData: () => {} })
    );
    act(() => {
      wsHandler?.({ type: "execution:started", payload: { cardId: "card-1", executionId: "e1", phase: "run" } });
    });
    expect(result.current.working).toBe(true);
    act(() => {
      wsHandler?.({ type: "execution:idle", payload: { cardId: "card-1" } });
    });
    expect(result.current.working).toBe(false);
  });

  it("ignores execution:started for a different card", () => {
    const { result } = renderHook(() =>
      useTerminal({ cardId: "card-1", active: false, onData: () => {} })
    );
    act(() => {
      wsHandler?.({ type: "execution:started", payload: { cardId: "card-2", executionId: "e1", phase: "run" } });
    });
    expect(result.current.working).toBe(false);
  });

  it("sets working=false on terminal:exit for this card", () => {
    const { result } = renderHook(() =>
      useTerminal({ cardId: "card-1", active: false, onData: () => {} })
    );
    act(() => {
      wsHandler?.({ type: "execution:started", payload: { cardId: "card-1", executionId: "e1", phase: "run" } });
    });
    expect(result.current.working).toBe(true);
    act(() => {
      wsHandler?.({ type: "terminal:exit", payload: { cardId: "card-1", exitCode: 0 } });
    });
    expect(result.current.working).toBe(false);
  });

  it("stop calls terminalApi.stop with the cardId", () => {
    const { result } = renderHook(() =>
      useTerminal({ cardId: "card-1", active: false, onData: () => {} })
    );
    act(() => {
      result.current.stop();
    });
    expect(terminalApi.stop).toHaveBeenCalledWith("card-1");
  });
});

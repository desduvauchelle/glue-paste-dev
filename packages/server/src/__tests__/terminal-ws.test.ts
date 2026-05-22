import { describe, it, expect, mock } from "bun:test";
import { handleTerminalMessage } from "../terminal-ws.js";
import type { TerminalHub } from "@glue-paste-dev/core";

function fakeHub() {
  return {
    attach: mock(),
    detach: mock(),
    heartbeat: mock(),
    input: mock(),
    resize: mock(),
  } as unknown as TerminalHub;
}

describe("handleTerminalMessage", () => {
  it("routes attach", () => {
    const hub = fakeHub();
    handleTerminalMessage(hub, "client-1", JSON.stringify({ type: "terminal:attach", cardId: "c1" }));
    expect(hub.attach).toHaveBeenCalledWith("client-1", "c1");
  });

  it("routes detach", () => {
    const hub = fakeHub();
    handleTerminalMessage(hub, "client-1", JSON.stringify({ type: "terminal:detach", cardId: "c1" }));
    expect(hub.detach).toHaveBeenCalledWith("client-1", "c1");
  });

  it("routes input", () => {
    const hub = fakeHub();
    handleTerminalMessage(hub, "client-1", JSON.stringify({ type: "terminal:input", cardId: "c1", data: "x" }));
    expect(hub.input).toHaveBeenCalledWith("c1", "x");
  });

  it("routes heartbeat and resize", () => {
    const hub = fakeHub();
    handleTerminalMessage(hub, "c-1", JSON.stringify({ type: "terminal:heartbeat", cardId: "c1" }));
    handleTerminalMessage(hub, "c-1", JSON.stringify({ type: "terminal:resize", cardId: "c1", cols: 90, rows: 30 }));
    expect(hub.heartbeat).toHaveBeenCalledWith("c-1", "c1");
    expect(hub.resize).toHaveBeenCalledWith("c1", 90, 30);
  });

  it("ignores input without string data", () => {
    const hub = fakeHub();
    handleTerminalMessage(hub, "c-1", JSON.stringify({ type: "terminal:input", cardId: "c1" }));
    expect(hub.input).not.toHaveBeenCalled();
  });

  it("ignores resize without numeric cols/rows", () => {
    const hub = fakeHub();
    handleTerminalMessage(hub, "c-1", JSON.stringify({ type: "terminal:resize", cardId: "c1", cols: "90", rows: 30 }));
    expect(hub.resize).not.toHaveBeenCalled();
  });

  it("ignores messages without a cardId", () => {
    const hub = fakeHub();
    handleTerminalMessage(hub, "c-1", JSON.stringify({ type: "terminal:attach" }));
    expect(hub.attach).not.toHaveBeenCalled();
  });

  it("ignores non-terminal and malformed messages", () => {
    const hub = fakeHub();
    handleTerminalMessage(hub, "c-1", JSON.stringify({ type: "something:else" }));
    handleTerminalMessage(hub, "c-1", "not json");
    expect(hub.attach).not.toHaveBeenCalled();
    expect(hub.input).not.toHaveBeenCalled();
  });
});

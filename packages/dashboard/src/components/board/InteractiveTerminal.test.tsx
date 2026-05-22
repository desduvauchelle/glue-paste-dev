import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const writeSpy = vi.fn();
let dataHandler: ((d: string) => void) | undefined;
const sendInputSpy = vi.fn();
const stopSpy = vi.fn();
let capturedOnData: ((data: string) => void) | undefined;

// Controls what useTerminal returns so we can flip `working` per test.
let mockWorking = false;

vi.mock("xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options: Record<string, unknown> = {};
    loadAddon() {}
    open() {}
    write = writeSpy;
    onData(cb: (d: string) => void) {
      dataHandler = cb;
    }
    onResize() {}
    dispose() {}
  },
}));
vi.mock("xterm-addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("xterm/css/xterm.css", () => ({}));
vi.mock("../../hooks/use-terminal", () => ({
  useTerminal: (args: { onData: (d: string) => void }) => {
    capturedOnData = args.onData;
    return { sendInput: sendInputSpy, sendResize: vi.fn(), working: mockWorking, stop: stopSpy };
  },
}));

import { InteractiveTerminal } from "./InteractiveTerminal";

describe("InteractiveTerminal", () => {
  beforeEach(() => {
    writeSpy.mockClear();
    sendInputSpy.mockClear();
    stopSpy.mockClear();
    dataHandler = undefined;
    capturedOnData = undefined;
    mockWorking = false;
  });

  it("mounts and renders the xterm container", () => {
    const { container } = render(<InteractiveTerminal cardId="c1" active />);
    expect(container.querySelector(".gpd-xterm")).not.toBeNull();
  });

  it("writes output from useTerminal.onData into the terminal", () => {
    render(<InteractiveTerminal cardId="c1" active />);
    capturedOnData?.("hello world");
    expect(writeSpy).toHaveBeenCalledWith("hello world");
  });

  it("forwards xterm keystrokes to sendInput when not working", () => {
    mockWorking = false;
    render(<InteractiveTerminal cardId="c1" active />);
    dataHandler?.("x");
    expect(sendInputSpy).toHaveBeenCalledWith("x");
  });

  it("blocks xterm keystrokes when working", () => {
    mockWorking = true;
    render(<InteractiveTerminal cardId="c1" active />);
    dataHandler?.("x");
    expect(sendInputSpy).not.toHaveBeenCalled();
  });

  it("shows idle status text when not working", () => {
    mockWorking = false;
    render(<InteractiveTerminal cardId="c1" active />);
    expect(screen.getByText("Idle — you can type")).toBeTruthy();
  });

  it("does not render Stop button when idle", () => {
    mockWorking = false;
    render(<InteractiveTerminal cardId="c1" active />);
    expect(screen.queryByRole("button", { name: /stop/i })).toBeNull();
  });

  it("shows working status text and Stop button when working", () => {
    mockWorking = true;
    render(<InteractiveTerminal cardId="c1" active />);
    expect(screen.getByText("Working…")).toBeTruthy();
    expect(screen.getByRole("button", { name: /stop/i })).toBeTruthy();
  });

  it("calls stop when Stop button is clicked", () => {
    mockWorking = true;
    render(<InteractiveTerminal cardId="c1" active />);
    fireEvent.click(screen.getByRole("button", { name: /stop/i }));
    expect(stopSpy).toHaveBeenCalledOnce();
  });
});

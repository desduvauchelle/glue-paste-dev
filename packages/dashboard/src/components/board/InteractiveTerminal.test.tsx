import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const writeSpy = vi.fn();
let dataHandler: ((d: string) => void) | undefined;
const sendInputSpy = vi.fn();
let capturedOnData: ((data: string) => void) | undefined;

vi.mock("xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
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
    return { sendInput: sendInputSpy, sendResize: vi.fn() };
  },
}));

import { InteractiveTerminal } from "./InteractiveTerminal";

describe("InteractiveTerminal", () => {
  beforeEach(() => {
    writeSpy.mockClear();
    sendInputSpy.mockClear();
    dataHandler = undefined;
    capturedOnData = undefined;
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

  it("forwards xterm keystrokes to sendInput", () => {
    render(<InteractiveTerminal cardId="c1" active />);
    dataHandler?.("x");
    expect(sendInputSpy).toHaveBeenCalledWith("x");
  });
});

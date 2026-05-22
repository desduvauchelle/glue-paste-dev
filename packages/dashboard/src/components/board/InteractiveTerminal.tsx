import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import { useTerminal } from "../../hooks/use-terminal";

export function InteractiveTerminal({
  cardId,
  active,
}: {
  cardId: string;
  active: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sendRef = useRef<{
    sendInput: (d: string) => void;
    sendResize: (c: number, r: number) => void;
  }>({
    sendInput: () => {},
    sendResize: () => {},
  });

  const { sendInput, sendResize, working, stop } = useTerminal({
    cardId,
    active,
    onData: (data) => termRef.current?.write(data),
    onExit: () => termRef.current?.write("\r\n[session ended]\r\n"),
  });
  sendRef.current = { sendInput, sendResize };

  // Keep a ref so the onData handler (registered once) always sees the latest value.
  const workingRef = useRef(working);
  workingRef.current = working;

  useEffect(() => {
    if (!containerRef.current || termRef.current) return;
    const term = new Terminal({
      convertEol: false,
      fontSize: 13,
      cursorBlink: true,
      theme: { background: "#0b0b0c" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    term.onData((d) => { if (!workingRef.current) sendRef.current.sendInput(d); });
    term.onResize(({ cols, rows }) => sendRef.current.sendResize(cols, rows));
    termRef.current = term;
    fitRef.current = fit;
    return () => {
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // Reflect working state on the xterm instance.
  useEffect(() => {
    const t = termRef.current;
    if (!t) return;
    t.options.disableStdin = working;
    t.options.cursorBlink = !working;
  }, [working]);

  // Refit when the tab becomes active or the window resizes.
  useEffect(() => {
    if (!active) return;
    const refit = () => {
      fitRef.current?.fit();
      const t = termRef.current;
      if (t) sendRef.current.sendResize(t.cols, t.rows);
    };
    refit();
    window.addEventListener("resize", refit);
    return () => window.removeEventListener("resize", refit);
  }, [active]);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between px-2 py-1 text-xs text-neutral-400">
        <span>{working ? "Working…" : "Idle — you can type"}</span>
        {working && (
          <button
            type="button"
            onClick={stop}
            className="rounded bg-red-600/80 px-2 py-0.5 text-white hover:bg-red-600"
          >
            Stop
          </button>
        )}
      </div>
      <div
        ref={containerRef}
        className="gpd-xterm min-h-0 flex-1 w-full overflow-hidden rounded bg-[#0b0b0c]"
      />
    </div>
  );
}

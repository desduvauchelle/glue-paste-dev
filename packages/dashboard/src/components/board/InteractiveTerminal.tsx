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

  const { sendInput, sendResize } = useTerminal({
    cardId,
    active,
    onData: (data) => termRef.current?.write(data),
    onExit: () => termRef.current?.write("\r\n[session ended]\r\n"),
  });
  sendRef.current = { sendInput, sendResize };

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
    term.onData((d) => sendRef.current.sendInput(d));
    term.onResize(({ cols, rows }) => sendRef.current.sendResize(cols, rows));
    termRef.current = term;
    fitRef.current = fit;
    return () => {
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

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
    <div
      ref={containerRef}
      className="gpd-xterm h-full w-full overflow-hidden rounded bg-[#0b0b0c]"
    />
  );
}

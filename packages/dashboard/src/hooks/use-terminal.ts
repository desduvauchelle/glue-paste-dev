import { useCallback, useEffect, useRef, useState } from "react";
import { terminal as terminalApi } from "@/lib/api";
import { sendWS, useWebSocket } from "@/lib/ws";

export interface UseTerminalArgs {
  cardId: string;
  /** The Live tab is mounted/visible. */
  active: boolean;
  onData: (data: string) => void;
  onExit?: (code: number) => void;
}

interface TerminalPayload {
  cardId: string;
  data?: string;
  exitCode?: number;
}

interface CardUpdatedPayload {
  id?: string;
  session_state?: string | null;
}

export function useTerminal({ cardId, active, onData, onExit }: UseTerminalArgs) {
  const onDataRef = useRef(onData);
  onDataRef.current = onData;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  const [working, setWorking] = useState(false);

  // Receive output / exit / execution state for THIS card.
  useWebSocket((event) => {
    if (
      event.type !== "terminal:output" &&
      event.type !== "terminal:exit" &&
      event.type !== "card:updated"
    ) return;

    if (event.type === "card:updated") {
      const payload = event.payload as CardUpdatedPayload;
      if (payload?.id === cardId) {
        setWorking(payload.session_state === "working");
      }
      return;
    }

    const payload = event.payload as TerminalPayload;
    if (payload?.cardId !== cardId) return;
    if (event.type === "terminal:output" && payload.data) onDataRef.current(payload.data);
    if (event.type === "terminal:exit") {
      setWorking(false);
      onExitRef.current?.(payload.exitCode ?? 0);
    }
  });

  // Open + attach + replay scrollback when activated.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      await terminalApi.open(cardId, { cols: 80, rows: 24 });
      if (cancelled) return;
      const status = await terminalApi.status(cardId);
      if (cancelled) return;
      if (status.scrollback) onDataRef.current(status.scrollback);
      sendWS({ type: "terminal:attach", cardId });
    })();
    return () => {
      cancelled = true;
      sendWS({ type: "terminal:detach", cardId });
    };
  }, [cardId, active]);

  // Heartbeat while the tab is visible/focused → server treats this as "watching".
  // Interval (3000ms) must stay below the server's watch window (6000ms).
  useEffect(() => {
    if (!active) return;
    const beat = () => {
      if (document.visibilityState === "visible") sendWS({ type: "terminal:heartbeat", cardId });
    };
    beat();
    const id = setInterval(beat, 3000);
    return () => clearInterval(id);
  }, [cardId, active]);

  const sendInput = useCallback(
    (data: string) => sendWS({ type: "terminal:input", cardId, data }),
    [cardId]
  );
  const sendResize = useCallback(
    (cols: number, rows: number) => sendWS({ type: "terminal:resize", cardId, cols, rows }),
    [cardId]
  );
  const stop = useCallback(() => { void terminalApi.stop(cardId); }, [cardId]);

  return { sendInput, sendResize, working, stop };
}

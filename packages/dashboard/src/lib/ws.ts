import { useEffect, useRef, useCallback } from "react";

interface WSEvent {
  type: string;
  payload: unknown;
}

type WSListener = (event: WSEvent) => void;

const DEBUG = import.meta.env.DEV || import.meta.env.VITE_GPD_DEBUG === "1";
function dbg(...args: unknown[]) {
  if (DEBUG) console.debug("[gpd:ws]", ...args);
}

const listeners = new Set<WSListener>();
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
let wasConnected = false;

// ---------------------------------------------------------------------------
// Tauri event bridge — active only in IPC mode
// ---------------------------------------------------------------------------

const IS_IPC = (import.meta.env.VITE_BACKEND as string | undefined) === "ipc";

const TAURI_WS_EVENTS = [
  "execution:started",
  "execution:output",
  "execution:completed",
  "card:updated",
  "comment:added",
  "queue:updated",
  "queue:stopped",
  "notification",
  "chat:output",
  "chat:completed",
] as const;

/** Fire an event into the shared listener registry (used by both WS and Tauri paths). */
function dispatch(event: WSEvent): void {
  for (const listener of listeners) {
    listener(event);
  }
}

// Wire up Tauri listeners once at module initialisation time when in IPC mode.
// Dynamic import keeps the Tauri API out of the bundle in HTTP mode.
if (IS_IPC) {
  import("@tauri-apps/api/event").then(({ listen }) => {
    for (const evtType of TAURI_WS_EVENTS) {
      listen<unknown>(evtType, (e) => {
        dbg("tauri←", evtType, e.payload);
        dispatch({ type: evtType, payload: e.payload });
      }).catch((err) => {
        console.error("[gpd:ws] Failed to register Tauri listener for", evtType, err);
      });
    }
    dbg("Tauri event bridge active");
  }).catch((err) => {
    console.error("[gpd:ws] Failed to import @tauri-apps/api/event:", err);
  });
}

function connect() {
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) {
    return;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${window.location.host}/ws`;

  ws = new WebSocket(url);

  ws.onopen = () => {
    dbg("Connected to", url);
    reconnectDelay = 1000;
    if (wasConnected) {
      dbg("Reconnected — notifying listeners");
      for (const listener of listeners) {
        listener({ type: "ws:reconnected", payload: null });
      }
    }
    wasConnected = true;
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data as string) as WSEvent;
      for (const listener of listeners) {
        listener(data);
      }
    } catch (err) {
      console.error("[gpd:ws] Failed to parse message:", err);
    }
  };

  ws.onclose = (ev) => {
    dbg("Disconnected", ev.code, ev.reason);
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = (ev) => {
    console.error("[gpd:ws] Error:", ev);
    ws?.close();
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    connect();
  }, reconnectDelay);
}

function subscribe(listener: WSListener): () => void {
  listeners.add(listener);
  // In IPC mode the Tauri event bridge (wired above) feeds dispatch(); skip WS.
  if (!IS_IPC && listeners.size === 1) connect();
  return () => {
    listeners.delete(listener);
  };
}

export function sendWS(message: unknown): boolean {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
    return true;
  }
  return false;
}

export function useWebSocket(onEvent: WSListener) {
  const callbackRef = useRef(onEvent);
  callbackRef.current = onEvent;

  useEffect(() => {
    const handler: WSListener = (event) => callbackRef.current(event);
    return subscribe(handler);
  }, []);
}

export function useWSEvent(type: string, handler: (payload: unknown) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const listener = useCallback(
    (event: WSEvent) => {
      if (event.type === type) {
        handlerRef.current(event.payload);
      }
    },
    [type]
  );

  useWebSocket(listener);
}

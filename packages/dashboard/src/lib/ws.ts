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
  if (listeners.size === 1) connect();
  return () => {
    listeners.delete(listener);
  };
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

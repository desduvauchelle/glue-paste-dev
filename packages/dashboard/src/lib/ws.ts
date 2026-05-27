import { useEffect, useRef, useCallback } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

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
  "terminal:output",
  "terminal:exited",
  "terminal:permission-pending",
  "terminal:idle",
  "terminal:session-state",
] as const;

function dispatch(event: WSEvent): void {
  for (const fn of listeners) fn(event);
}

const unlistenFns: UnlistenFn[] = [];
let bridgeStarted = false;

function startBridge(): void {
  if (bridgeStarted) return;
  bridgeStarted = true;
  for (const evtType of TAURI_WS_EVENTS) {
    listen<unknown>(evtType, (e) => {
      dbg("tauri←", evtType, e.payload);
      dispatch({ type: evtType, payload: e.payload });
    })
      .then((un) => unlistenFns.push(un))
      .catch((err) => {
        console.error("[gpd:ws] Failed to register Tauri listener for", evtType, err);
      });
  }
  dbg("Tauri event bridge active");
}

startBridge();

/** Send a message to the backend. In Tauri mode, only terminal:input and terminal:resize are routed. */
export function sendWS(message: unknown): boolean {
  const msg = message as { type?: string; cardId?: string; data?: string; cols?: number; rows?: number };
  if (!msg?.type?.startsWith("terminal:") || !msg.cardId) return false;
  switch (msg.type) {
    case "terminal:input":
      if (typeof msg.data === "string") {
        invoke<void>("terminal_input", { cardId: msg.cardId, data: msg.data }).catch(() => {});
      }
      return true;
    case "terminal:resize":
      if (typeof msg.cols === "number" && typeof msg.rows === "number") {
        invoke<void>("terminal_resize", { cardId: msg.cardId, cols: msg.cols, rows: msg.rows }).catch(() => {});
      }
      return true;
    default:
      return false;
  }
}

/** Subscribe a callback to every WS event. Returns unsubscribe. */
export function subscribe(listener: WSListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React hook: subscribe to all WS events for the lifetime of the component. */
export function useWebSocket(onEvent: WSListener): void {
  const ref = useRef(onEvent);
  ref.current = onEvent;
  useEffect(() => {
    const unsub = subscribe((evt) => ref.current(evt));
    return unsub;
  }, []);
}

/** React hook: subscribe to a single WS event type. */
export function useWSEvent(type: string, handler: (payload: unknown) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  const onEvent = useCallback((evt: WSEvent) => {
    if (evt.type === type) ref.current(evt.payload);
  }, [type]);
  useWebSocket(onEvent);
}

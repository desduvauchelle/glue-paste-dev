import { useEffect, useRef, useSyncExternalStore } from "react";
import { useWebSocket } from "./ws";

export interface Toast {
  id: string;
  level: "success" | "error" | "info";
  title: string;
  message: string;
  timestamp: number;
}

let nextId = 0;
let toasts: Toast[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function addToast(level: Toast["level"], title: string, message: string) {
  const toast: Toast = {
    id: String(++nextId),
    level,
    title,
    message,
    timestamp: Date.now(),
  };
  toasts = [...toasts, toast];
  emit();

  // Auto-remove after 5s
  setTimeout(() => {
    removeToast(toast.id);
  }, 5000);

  // Desktop notification
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification(title, { body: message });
  }
}

export function removeToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => toasts,
  );
}

/** Request notification permission on mount */
export function useNotificationPermission() {
  const requested = useRef(false);
  useEffect(() => {
    if (
      requested.current ||
      typeof Notification === "undefined" ||
      Notification.permission !== "default"
    ) return;
    requested.current = true;
    void Notification.requestPermission();
  }, []);
}

/** Listen for server notification events and show toasts */
export function useNotificationListener() {
  useWebSocket((event) => {
    if (event.type === "notification") {
      const { level, title, message } = event.payload as {
        level: Toast["level"];
        title: string;
        message: string;
      };
      addToast(level, title, message);
    }
  });
}

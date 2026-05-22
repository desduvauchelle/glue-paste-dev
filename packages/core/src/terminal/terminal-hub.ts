import { log } from "../logger.js";
import type { TerminalPermissionMode } from "../schemas/config.js";

/** Minimal surface the hub needs from a session — lets tests inject a fake. */
export interface SessionLike {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  getScrollback(): string;
  isRunning(): boolean;
}

export interface OpenOptions {
  cwd: string;
  cols: number;
  rows: number;
}

export interface TerminalHubOptions {
  permissionMode: TerminalPermissionMode;
  createSession: (
    cardId: string,
    onData: (chunk: string) => void,
    onExit: (code: number) => void,
    opts: OpenOptions
  ) => SessionLike;
  onOutput: (cardId: string, data: string) => void;
  onExit: (cardId: string, code: number) => void;
  /** Delay before auto-answering when unwatched. Default 1500ms. */
  graceMs?: number;
  /** A heartbeat counts as "watching" for this long. Default 6000ms. */
  watchWindowMs?: number;
}

interface SessionEntry {
  session: SessionLike;
  subscribers: Set<string>;
  lastHeartbeat: Map<string, number>;
  pendingPromptTimer: ReturnType<typeof setTimeout> | null;
  buffer: string;
}

const BUFFER_TAIL = 8000;

export class TerminalHub {
  private sessions = new Map<string, SessionEntry>();
  private graceMs: number;
  private watchWindowMs: number;

  constructor(private opts: TerminalHubOptions) {
    this.graceMs = opts.graceMs ?? 1500;
    this.watchWindowMs = opts.watchWindowMs ?? 6000;
  }

  open(cardId: string, opts: OpenOptions): void {
    if (this.sessions.has(cardId)) return;
    const entry: SessionEntry = {
      session: null as never,
      subscribers: new Set(),
      lastHeartbeat: new Map(),
      pendingPromptTimer: null,
      buffer: "",
    };
    entry.session = this.opts.createSession(
      cardId,
      (chunk) => this.handleData(cardId, chunk),
      (code) => this.handleExit(cardId, code),
      opts
    );
    this.sessions.set(cardId, entry);
    log.info("terminal-hub", `opened session card=${cardId} cwd=${opts.cwd}`);
  }

  attach(clientId: string, cardId: string): void {
    const e = this.sessions.get(cardId);
    if (!e) return;
    e.subscribers.add(clientId);
  }

  detach(clientId: string, cardId: string): void {
    const e = this.sessions.get(cardId);
    if (!e) return;
    e.subscribers.delete(clientId);
    e.lastHeartbeat.delete(clientId);
  }

  detachClientEverywhere(clientId: string): void {
    for (const cardId of this.sessions.keys()) this.detach(clientId, cardId);
  }

  heartbeat(clientId: string, cardId: string): void {
    const e = this.sessions.get(cardId);
    if (!e) return;
    e.subscribers.add(clientId);
    e.lastHeartbeat.set(clientId, Date.now());
  }

  isWatched(cardId: string): boolean {
    const e = this.sessions.get(cardId);
    if (!e) return false;
    const now = Date.now();
    for (const ts of e.lastHeartbeat.values()) {
      if (now - ts <= this.watchWindowMs) return true;
    }
    return false;
  }

  input(cardId: string, data: string): void {
    this.sessions.get(cardId)?.session.write(data);
  }

  resize(cardId: string, cols: number, rows: number): void {
    this.sessions.get(cardId)?.session.resize(cols, rows);
  }

  getScrollback(cardId: string): string {
    return this.sessions.get(cardId)?.session.getScrollback() ?? "";
  }

  isRunning(cardId: string): boolean {
    return this.sessions.get(cardId)?.session.isRunning() ?? false;
  }

  close(cardId: string): void {
    const e = this.sessions.get(cardId);
    if (!e) return;
    if (e.pendingPromptTimer) clearTimeout(e.pendingPromptTimer);
    e.session.kill();
    this.sessions.delete(cardId);
  }

  closeAll(): void {
    for (const cardId of [...this.sessions.keys()]) this.close(cardId);
  }

  private handleData(cardId: string, chunk: string): void {
    this.opts.onOutput(cardId, chunk);
    const e = this.sessions.get(cardId);
    if (!e) return;
    e.buffer = (e.buffer + chunk).slice(-BUFFER_TAIL);
    this.maybeHandlePermission(cardId, e);
  }

  private handleExit(cardId: string, code: number): void {
    const e = this.sessions.get(cardId);
    if (e?.pendingPromptTimer) clearTimeout(e.pendingPromptTimer);
    this.opts.onExit(cardId, code);
    this.sessions.delete(cardId);
  }

  // Placeholder; real logic in Task 5.
  private maybeHandlePermission(_cardId: string, _e: SessionEntry): void {}
}

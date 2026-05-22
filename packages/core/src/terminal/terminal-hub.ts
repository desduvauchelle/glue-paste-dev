import { log } from "../logger.js";
import { detectPermissionPrompt } from "./permission-detector.js";
import { detectIdle } from "./idle-detector.js";
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
  /** Override the default launch command for this specific session. */
  command?: string[];
  /** If set, hub delivers this text via bracketed paste and submits it after initialInputDelayMs. */
  initialInput?: string;
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
  /** Called when a session transitions to idle (turn complete). */
  onIdle?: (cardId: string) => void;
  /** Called when a session transitions from idle to busy (working). */
  onBusy?: (cardId: string) => void;
  /** Called when a permission prompt appears (pending=true) or clears (pending=false). */
  onPermissionPending?: (cardId: string, pending: boolean) => void;
  /** Delay in ms before writing the submit \r after initial input. Default 300. */
  initialInputDelayMs?: number;
  /** Maximum number of concurrent sessions before LRU eviction kicks in. Default 12. */
  maxSessions?: number;
}

export type TurnEndResult = { reason: "idle" } | { reason: "exit"; code: number };

interface SessionEntry {
  session: SessionLike;
  subscribers: Set<string>;
  lastHeartbeat: Map<string, number>;
  pendingPromptTimer: ReturnType<typeof setTimeout> | null;
  buffer: string;
  wasIdle: boolean;
  idleDetectionActive: boolean;
  turnEndWaiters: Array<(r: TurnEndResult) => void>;
  lastActivity: number;
  permissionPending: boolean;
}

const BUFFER_TAIL = 8000;

export class TerminalHub {
  private sessions = new Map<string, SessionEntry>();
  private graceMs: number;
  private watchWindowMs: number;
  private initialInputDelayMs: number;
  private maxSessions: number;

  constructor(private opts: TerminalHubOptions) {
    this.graceMs = opts.graceMs ?? 1500;
    this.watchWindowMs = opts.watchWindowMs ?? 6000;
    this.initialInputDelayMs = opts.initialInputDelayMs ?? 300;
    this.maxSessions = opts.maxSessions ?? 12;
  }

  open(cardId: string, opts: OpenOptions): void {
    if (this.sessions.has(cardId)) return;

    // LRU eviction: if at capacity, close the oldest idle+unwatched session
    if (this.sessions.size >= this.maxSessions) {
      let victim: string | null = null;
      let oldest = Infinity;
      for (const [id, entry] of this.sessions) {
        if (!entry.wasIdle) continue;         // never evict a working session
        if (this.isWatched(id)) continue;     // never evict a session someone is watching
        if (entry.lastActivity < oldest) { oldest = entry.lastActivity; victim = id; }
      }
      if (victim) this.close(victim);
      // If no evictable session exists, proceed without evicting
    }

    const hasInitialInput = opts.initialInput != null;
    const entry: SessionEntry = {
      session: null as never,
      subscribers: new Set(),
      lastHeartbeat: new Map(),
      pendingPromptTimer: null,
      buffer: "",
      wasIdle: false,
      // Gate: if we have initialInput, hold off detection until after submit
      idleDetectionActive: !hasInitialInput,
      turnEndWaiters: [],
      lastActivity: Date.now(),
      permissionPending: false,
    };
    entry.session = this.opts.createSession(
      cardId,
      (chunk) => this.handleData(cardId, chunk),
      (code) => this.handleExit(cardId, code),
      opts
    );
    this.sessions.set(cardId, entry);
    log.info("terminal-hub", `opened session card=${cardId} cwd=${opts.cwd}`);

    if (hasInitialInput) {
      entry.session.write("\x1b[200~" + opts.initialInput + "\x1b[201~");
      setTimeout(() => {
        entry.idleDetectionActive = true;
        entry.session.write("\r");
      }, this.initialInputDelayMs);
    }
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
    const e = this.sessions.get(cardId);
    if (!e) return;
    // If the user is answering a permission prompt, clear the pending state and
    // drop the answered prompt from the buffer so it isn't re-detected (re-locks input).
    if (e.permissionPending) {
      e.permissionPending = false;
      e.buffer = "";
      this.opts.onPermissionPending?.(cardId, false);
    }
    e.session.write(data);
  }

  interrupt(cardId: string): void {
    this.sessions.get(cardId)?.session.write("\x03");
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

  waitForTurnEnd(cardId: string): Promise<TurnEndResult> {
    const e = this.sessions.get(cardId);
    if (!e) return Promise.resolve({ reason: "exit", code: -1 });
    return new Promise((resolve) => { e.turnEndWaiters.push(resolve); });
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
    e.lastActivity = Date.now();
    e.buffer = (e.buffer + chunk).slice(-BUFFER_TAIL);
    // Permission-pending signal (independent of auto-answer mode): a prompt on
    // screen means the user may need to answer — the dashboard unlocks input on it.
    const promptNow = detectPermissionPrompt(e.buffer) != null;
    if (promptNow !== e.permissionPending) {
      e.permissionPending = promptNow;
      this.opts.onPermissionPending?.(cardId, promptNow);
    }
    this.maybeHandlePermission(cardId, e);
    if (e.idleDetectionActive) {
      const idle = detectIdle(chunk);
      if (idle && !e.wasIdle) {
        e.wasIdle = true;
        this.opts.onIdle?.(cardId);
        const waiters = e.turnEndWaiters;
        e.turnEndWaiters = [];
        for (const w of waiters) w({ reason: "idle" });
      } else if (!idle && e.wasIdle) {
        e.wasIdle = false;
        this.opts.onBusy?.(cardId);
      }
    }
  }

  private handleExit(cardId: string, code: number): void {
    const e = this.sessions.get(cardId);
    if (e?.pendingPromptTimer) clearTimeout(e.pendingPromptTimer);
    this.opts.onExit(cardId, code);
    if (e) {
      const waiters = e.turnEndWaiters;
      e.turnEndWaiters = [];
      for (const w of waiters) w({ reason: "exit", code });
    }
    this.sessions.delete(cardId);
  }

  private maybeHandlePermission(cardId: string, e: SessionEntry): void {
    if (this.opts.permissionMode === "always-ask") return;
    const match = detectPermissionPrompt(e.buffer);
    if (!match) return;

    const answer = () => {
      // Re-check the prompt is still the latest thing on screen and unanswered.
      if (!detectPermissionPrompt(e.session.getScrollback())) return;
      e.session.write(match.acceptInput);
      e.buffer = ""; // consumed; avoid double-answering the same prompt
      log.info("terminal-hub", `auto-answered permission prompt card=${cardId}`);
    };

    if (this.opts.permissionMode === "always-auto") {
      if (e.pendingPromptTimer) return;
      e.pendingPromptTimer = setTimeout(() => {
        e.pendingPromptTimer = null;
        answer();
      }, 0);
      return;
    }

    // auto-unless-watching
    if (this.isWatched(cardId)) return; // human is here — let them answer
    if (e.pendingPromptTimer) return; // grace already running
    e.pendingPromptTimer = setTimeout(() => {
      e.pendingPromptTimer = null;
      if (this.isWatched(cardId)) return; // someone showed up during grace
      answer();
    }, this.graceMs);
  }
}

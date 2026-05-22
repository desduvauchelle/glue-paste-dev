# Interactive Terminal Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live, interactive terminal per card that runs the AI CLI in a real PTY (no `-p` print mode), so the user types prompts into a long-lived `claude` session in the card's repo directory, watches it work, and answers permission prompts — with prompts auto-answered when nobody is watching.

**Architecture:** A `PtySession` (core) wraps `Bun.spawn(..., { terminal })` to launch interactive `claude` with a real TTY. A `TerminalHub` (core) owns one session per card, tracks which dashboard clients are "watching", and routes I/O. A pure `permission-detector` recognises the CLI's permission prompt in the output stream; the hub auto-answers it only when no client is watching (after a grace window). The server exposes the hub over the existing `/ws` socket (made bidirectional) plus thin REST start/stop routes. The dashboard renders the session with the already-installed xterm.js in a new CardDialog sub-tab, sends keystrokes over the socket, and emits a heartbeat while the tab is visible so the server knows someone is watching. This sits **beside** the existing `-p` stream-json card pipeline — nothing in `runner.ts`/`chat.ts` is removed.

**Tech Stack:** Bun (core + server runtime), Bun built-in PTY (`Bun.spawn` `terminal` option, POSIX-only), Hono + `hono/bun` WebSocket, React 19 + xterm.js (`xterm@^5.3.0`, `xterm-addon-fit@^0.8.0`, already deps), Vitest (server/dashboard), `bun test` (core), Zod config schemas.

**Key risk (gated by Phase 0):** The exact byte pattern of the CLI's interactive permission prompt is unknown until observed. Phase 0 is a spike that captures it from a real run; the regex in Phase 2 is filled from that captured output. Do not write the matcher regex before Phase 0 produces the sample.

---

## File Structure

**New files:**
- `packages/core/src/terminal/pty-session.ts` — `PtySession` class: spawns interactive CLI in a Bun PTY, holds a scrollback ring buffer, emits output, exposes `write`/`resize`/`kill`/`status`.
- `packages/core/src/terminal/permission-detector.ts` — pure `detectPermissionPrompt(text)` → accept-keystroke or null.
- `packages/core/src/terminal/terminal-hub.ts` — `TerminalHub`: one session per card, watcher tracking, permission auto-answer policy/timers, I/O routing via injected callbacks.
- `packages/core/src/terminal/index.ts` — barrel export for the three above + types.
- `packages/core/src/terminal/__tests__/pty-session.test.ts`
- `packages/core/src/terminal/__tests__/permission-detector.test.ts`
- `packages/core/src/terminal/__tests__/terminal-hub.test.ts`
- `packages/server/src/terminal-ws.ts` — wires Bun `ServerWebSocket` open/message/close to a singleton `TerminalHub`; broadcasts session output; per-connection client id + subscription set.
- `packages/server/src/routes/terminal.ts` — REST: open/close/status a card's terminal session.
- `packages/server/src/__tests__/terminal-ws.test.ts`
- `packages/dashboard/src/hooks/use-terminal.ts` — opens/attaches a session, exposes output sink + send/resize/heartbeat.
- `packages/dashboard/src/components/board/InteractiveTerminal.tsx` — xterm.js view, keystroke→socket, visibility heartbeat.
- `packages/dashboard/src/components/board/__tests__/InteractiveTerminal.test.tsx`
- `docs/superpowers/spikes/2026-05-21-pty-prompt-sample.md` — Phase 0 captured output (committed reference for the matcher).

**Modified files:**
- `packages/core/src/schemas/config.ts` — add `terminalPermissionMode` to `ConfigInputSchema`, `ConfigSchema`, `DEFAULT_CONFIG`.
- `packages/core/src/index.ts` — re-export `./terminal/index.js`.
- `packages/server/src/index.ts` — replace stub WS handlers with `terminal-ws` wiring; mount `terminalRoutes`; kill sessions on shutdown.
- `packages/dashboard/src/lib/ws.ts` — add outbound `sendWS(message)` + connection-ready awareness.
- `packages/dashboard/src/lib/api.ts` — add `terminal.open/close/status`.
- `packages/dashboard/src/components/board/CardDialog.tsx` — add a "Live" sub-tab rendering `InteractiveTerminal`.

---

## Conventions used in this plan

- Type check after each phase (from `CLAUDE.md`): core `cd packages/core && bunx tsc --noEmit`; server `cd packages/server && bunx tsc --noEmit`; dashboard `cd packages/dashboard && bunx tsc -b`.
- Tests: core `cd packages/core && bun test <file>`; server `cd packages/server && bunx vitest run <file>`; dashboard `cd packages/dashboard && bunx vitest run <file>`.
- Commit after each task with the shown message. Do not push (per `CLAUDE.md`, commit only — no PR until the branch is finished).

---

## Phase 0 — Spike: prove the PTY path and capture the permission prompt (GATE)

No production code. This de-risks the two unknowns: (a) Bun PTY actually runs interactive `claude`, (b) the literal permission-prompt bytes.

### Task 0: PTY + prompt spike

**Files:**
- Create (throwaway): `packages/core/scratch/pty-spike.ts`
- Create (kept): `docs/superpowers/spikes/2026-05-21-pty-prompt-sample.md`

- [ ] **Step 1: Write the spike script**

```ts
// packages/core/scratch/pty-spike.ts
// Run from a real git repo dir: cd <some-repo> && bun /abs/path/pty-spike.ts
import { getFreshEnv } from "../src/executor/fresh-env.js";

const proc = Bun.spawn(["claude"], {
  cwd: process.cwd(),
  env: getFreshEnv(),
  terminal: {
    cols: 100,
    rows: 30,
    data: (_term, bytes) => process.stdout.write(bytes),
  },
});

// Forward our stdin to the PTY so we can drive it by hand.
process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on("data", (b) => proc.terminal!.write(b));

await proc.exited;
proc.terminal!.close();
process.exit(0);
```

- [ ] **Step 2: Run it against a scratch repo and confirm interactivity**

Run: `cd /tmp && rm -rf pty-spike-repo && git init pty-spike-repo && cd pty-spike-repo && bun /Users/denisduvauchelle/Documents/code/glue-paste-dev/packages/core/scratch/pty-spike.ts`
Expected: the real interactive `claude` TUI renders (not the `-p` one-shot). Type a prompt that forces a tool/edit, e.g. "create a file hello.txt containing hi". Confirm a **permission prompt** appears asking to approve the edit/command.

- [ ] **Step 3: Capture the exact permission-prompt bytes**

While the prompt is on screen, copy the rendered prompt text verbatim (including the option lines and the accept option, e.g. the "Yes" / "1." line). Note which keystroke accepts it (commonly `1` then Enter, or `Enter` on the default). Record the raw text — including any leading box-drawing characters — so the matcher can be written against reality, not a guess.

- [ ] **Step 4: Write the captured sample to the committed reference doc**

```markdown
# PTY interactive permission-prompt sample (2026-05-21)

CLI: claude (interactive, Bun PTY)

## Observed prompt (verbatim)

<paste the exact prompt block here>

## Accept keystroke

<e.g. "1\r" — record exactly what was typed to approve>

## Notes

- isTTY confirmed true (interactive TUI rendered, not -p output)
- Bun version: <bun --version>
- claude version: <claude --version>
```

- [ ] **Step 5: Decision gate**

If interactive `claude` rendered and a prompt was captured → proceed to Phase 1. If Bun PTY failed to attach (no TTY), STOP and report: fallback options are (a) `script -q /dev/null claude …` wrapper via `Bun.spawn` stdin/stdout, or (b) move the PTY into the Electron main process with `node-pty`. Do not continue building on a broken transport.

- [ ] **Step 6: Remove the throwaway script, keep the doc, commit**

```bash
rm -f packages/core/scratch/pty-spike.ts
git add docs/superpowers/spikes/2026-05-21-pty-prompt-sample.md
git commit -m "docs: capture interactive PTY permission-prompt sample (spike)"
```

---

## Phase 1 — Core: `PtySession`

A thin, testable wrapper over the Bun PTY. No card/permission logic here.

### Task 1: PtySession spawn + output buffer + write/kill

**Files:**
- Create: `packages/core/src/terminal/pty-session.ts`
- Test: `packages/core/src/terminal/__tests__/pty-session.test.ts`

- [ ] **Step 1: Write the failing test** (uses `cat` as a deterministic echo PTY — no `claude` needed)

```ts
// packages/core/src/terminal/__tests__/pty-session.test.ts
import { test, expect } from "bun:test";
import { PtySession } from "../pty-session.js";

test("PtySession echoes written input via onData and buffers scrollback", async () => {
  const chunks: string[] = [];
  const session = new PtySession({
    command: ["cat"],
    cwd: process.cwd(),
    env: process.env as Record<string, string>,
    cols: 80,
    rows: 24,
    onData: (s) => chunks.push(s),
  });

  session.write("hello\n");
  await Bun.sleep(150);

  const joined = chunks.join("");
  expect(joined).toContain("hello");
  expect(session.getScrollback()).toContain("hello");
  expect(session.isRunning()).toBe(true);

  session.kill();
  await Bun.sleep(50);
  expect(session.isRunning()).toBe(false);
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `cd packages/core && bun test src/terminal/__tests__/pty-session.test.ts`
Expected: FAIL — `Cannot find module '../pty-session.js'`.

- [ ] **Step 3: Implement `PtySession`**

```ts
// packages/core/src/terminal/pty-session.ts
import { log } from "../logger.js";

export interface PtySessionOptions {
  command: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  cols: number;
  rows: number;
  /** Called with every decoded output chunk from the PTY. */
  onData: (chunk: string) => void;
  /** Called once when the child exits. */
  onExit?: (exitCode: number) => void;
}

/** Max bytes of recent output kept for replay when a client (re)attaches. */
const SCROLLBACK_MAX = 256 * 1024;

/**
 * Wraps a single interactive child process running under a Bun pseudo-terminal.
 * The child sees a real TTY (isTTY === true), so CLIs render their interactive UI.
 */
export class PtySession {
  private proc: ReturnType<typeof Bun.spawn>;
  private decoder = new TextDecoder();
  private scrollback = "";
  private running = true;
  private exitCode: number | null = null;

  constructor(private opts: PtySessionOptions) {
    this.proc = Bun.spawn(opts.command, {
      cwd: opts.cwd,
      env: opts.env,
      terminal: {
        cols: opts.cols,
        rows: opts.rows,
        data: (_term, bytes: Uint8Array) => {
          const text = this.decoder.decode(bytes, { stream: true });
          this.appendScrollback(text);
          opts.onData(text);
        },
      },
    });

    this.proc.exited.then((code) => {
      this.running = false;
      this.exitCode = code;
      log.info("pty", `session exited code=${code} cmd=${opts.command[0]}`);
      opts.onExit?.(code);
    });
  }

  private appendScrollback(text: string): void {
    this.scrollback += text;
    if (this.scrollback.length > SCROLLBACK_MAX) {
      this.scrollback = this.scrollback.slice(-SCROLLBACK_MAX);
    }
  }

  /** Write raw input (keystrokes / a prompt line ending in "\r") to the PTY. */
  write(data: string): void {
    if (!this.running) return;
    this.proc.terminal?.write(data);
  }

  resize(cols: number, rows: number): void {
    if (!this.running) return;
    this.proc.terminal?.resize(cols, rows);
  }

  getScrollback(): string {
    return this.scrollback;
  }

  isRunning(): boolean {
    return this.running;
  }

  getExitCode(): number | null {
    return this.exitCode;
  }

  get pid(): number | undefined {
    return this.proc.pid;
  }

  kill(): void {
    if (!this.running) return;
    try {
      this.proc.terminal?.close();
    } catch {
      // already closed
    }
    try {
      this.proc.kill();
    } catch {
      // already dead
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/core && bun test src/terminal/__tests__/pty-session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/terminal/pty-session.ts packages/core/src/terminal/__tests__/pty-session.test.ts
git commit -m "feat(core): add PtySession PTY wrapper for interactive CLI"
```

---

## Phase 2 — Core: permission detector (pure)

Fill the regex/accept-key from the Phase 0 sample. The function is pure and fully unit-tested.

### Task 2: detectPermissionPrompt

**Files:**
- Create: `packages/core/src/terminal/permission-detector.ts`
- Test: `packages/core/src/terminal/__tests__/permission-detector.test.ts`

- [ ] **Step 1: Write the failing test** (replace the `PROMPT_SAMPLE` constant with the verbatim block captured in Phase 0)

```ts
// packages/core/src/terminal/__tests__/permission-detector.test.ts
import { test, expect } from "bun:test";
import { detectPermissionPrompt } from "../permission-detector.js";

// NOTE: paste the exact prompt block from docs/superpowers/spikes/2026-05-21-pty-prompt-sample.md
const PROMPT_SAMPLE = `Do you want to proceed?
❯ 1. Yes
  2. Yes, and don't ask again this session
  3. No, and tell Claude what to do differently`;

test("detects a permission prompt and returns the accept keystroke", () => {
  const r = detectPermissionPrompt(PROMPT_SAMPLE);
  expect(r).not.toBeNull();
  expect(r!.acceptInput).toBe("1\r");
});

test("returns null for ordinary assistant output", () => {
  expect(detectPermissionPrompt("Sure, here is the file you asked for.")).toBeNull();
});

test("only matches on the tail of a larger buffer", () => {
  const buf = "lots of earlier output\n".repeat(50) + PROMPT_SAMPLE;
  expect(detectPermissionPrompt(buf)).not.toBeNull();
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `cd packages/core && bun test src/terminal/__tests__/permission-detector.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the detector** (tune `PROMPT_PATTERN` and `acceptInput` to the Phase 0 sample; strip ANSI before matching)

```ts
// packages/core/src/terminal/permission-detector.ts

export interface PermissionPromptMatch {
  /** Exact bytes to write to the PTY to approve once. */
  acceptInput: string;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;?]*[A-Za-z]/g;

/**
 * Pattern that identifies the CLI's interactive permission prompt.
 * Derived from the captured sample in docs/superpowers/spikes/2026-05-21-pty-prompt-sample.md.
 * Match against the tail only; the prompt is the most recent thing on screen.
 */
const PROMPT_PATTERN = /Do you want to proceed\?[\s\S]*1\.\s*Yes/i;

/** Keystroke(s) that select the "Yes" (approve once) option. */
const ACCEPT_INPUT = "1\r";

/** How many trailing characters of the buffer to inspect. */
const TAIL = 4000;

export function detectPermissionPrompt(buffer: string): PermissionPromptMatch | null {
  const tail = buffer.slice(-TAIL).replace(ANSI, "");
  if (PROMPT_PATTERN.test(tail)) {
    return { acceptInput: ACCEPT_INPUT };
  }
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/core && bun test src/terminal/__tests__/permission-detector.test.ts`
Expected: PASS. If the sample differs from the placeholder above, adjust `PROMPT_PATTERN`/`ACCEPT_INPUT` and the test's `PROMPT_SAMPLE` together until green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/terminal/permission-detector.ts packages/core/src/terminal/__tests__/permission-detector.test.ts
git commit -m "feat(core): add interactive permission-prompt detector"
```

---

## Phase 3 — Core: config field for permission policy

### Task 3: add `terminalPermissionMode` to config

**Files:**
- Modify: `packages/core/src/schemas/config.ts`
- Test: `packages/core/src/terminal/__tests__/terminal-hub.test.ts` (created next task asserts default; here just wire schema)

- [ ] **Step 1: Add the enum + schema fields + default**

In `packages/core/src/schemas/config.ts`, after the `BranchMode` block (around line 29), add:

```ts
/** When to auto-answer interactive permission prompts in the live terminal. */
export const TERMINAL_PERMISSION_MODES = [
  "auto-unless-watching", // auto-answer only when nobody is watching (default)
  "always-ask",           // never auto-answer; a human must respond
  "always-auto",          // always auto-answer
] as const;
export const TerminalPermissionModeSchema = z.enum(TERMINAL_PERMISSION_MODES);
export type TerminalPermissionMode = z.infer<typeof TerminalPermissionModeSchema>;
```

In `ConfigSchema` (the DB shape, snake_case), add before the closing brace (after line 47):

```ts
  terminal_permission_mode: z.string().default("auto-unless-watching"),
```

In `ConfigInputSchema` (camelCase), add before the closing brace (after line 66):

```ts
  terminalPermissionMode: TerminalPermissionModeSchema.optional(),
```

In `DEFAULT_CONFIG`, add before the closing brace (after line 84):

```ts
  terminalPermissionMode: "auto-unless-watching" as TerminalPermissionMode,
```

- [ ] **Step 2: Type-check core**

Run: `cd packages/core && bunx tsc --noEmit`
Expected: no errors. (If the config DB mapping layer enumerates columns explicitly, also add `terminal_permission_mode` there; grep `custom_instructions` to find the same spots and mirror them. Search: `cd packages/core && grep -rn "custom_instructions\|customInstructions" src/db src/config* 2>/dev/null` and replicate the field in each mapping it appears.)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/schemas/config.ts
git commit -m "feat(core): add terminalPermissionMode config field"
```

> **Migration note for the implementer:** the existing config table is created/altered somewhere in `packages/core/src/db`. Find the executions/config `ALTER TABLE` precedent (memory: `system_prompt`/`pid` columns were added via `ALTER`). Add an idempotent `ALTER TABLE config ADD COLUMN terminal_permission_mode TEXT NOT NULL DEFAULT 'auto-unless-watching'` in the same migration function. Verify by running the server once and confirming no SQL error. This is required only if config is column-per-field rather than a JSON blob — check first with `grep -rn "ADD COLUMN" packages/core/src/db`.

---

## Phase 4 — Core: `TerminalHub` (the brain)

Owns sessions per card, tracks watchers, runs the permission policy. PTY creation is injected so the hub is testable with a fake.

### Task 4: TerminalHub session lifecycle + watcher tracking

**Files:**
- Create: `packages/core/src/terminal/terminal-hub.ts`
- Test: `packages/core/src/terminal/__tests__/terminal-hub.test.ts`

- [ ] **Step 1: Write the failing test** (uses a fake session factory; no real PTY)

```ts
// packages/core/src/terminal/__tests__/terminal-hub.test.ts
import { test, expect } from "bun:test";
import { TerminalHub, type SessionLike } from "../terminal-hub.js";

function makeFakeSession() {
  const writes: string[] = [];
  let onExit: ((c: number) => void) | undefined;
  const fake: SessionLike & { emit: (s: string) => void; fireExit: (c: number) => void } = {
    write: (d) => writes.push(d),
    resize: () => {},
    kill: () => {},
    getScrollback: () => "",
    isRunning: () => true,
    _onData: () => {},
    emit(s) {
      this._onData(s);
    },
    fireExit(c) {
      onExit?.(c);
    },
    get writes() {
      return writes;
    },
  } as never;
  return { fake, setOnExit: (f: (c: number) => void) => (onExit = f) };
}

test("opens one session per card and routes output to subscribers", () => {
  const outputs: Array<{ cardId: string; data: string }> = [];
  const { fake } = makeFakeSession();
  const hub = new TerminalHub({
    permissionMode: "always-ask",
    createSession: (_cardId, onData) => {
      (fake as never as { _onData: (s: string) => void })._onData = onData;
      return fake;
    },
    onOutput: (cardId, data) => outputs.push({ cardId, data }),
    onExit: () => {},
    graceMs: 10,
  });

  hub.open("card-1", { cwd: "/tmp", cols: 80, rows: 24 });
  hub.attach("client-A", "card-1");
  (fake as never as { emit: (s: string) => void }).emit("hi from cli");

  expect(outputs).toEqual([{ cardId: "card-1", data: "hi from cli" }]);
  expect(hub.isWatched("card-1")).toBe(false); // attached but no heartbeat yet
});

test("heartbeat within window marks card as watched", () => {
  const { fake } = makeFakeSession();
  const hub = new TerminalHub({
    permissionMode: "auto-unless-watching",
    createSession: (_c, onData) => {
      (fake as never as { _onData: (s: string) => void })._onData = onData;
      return fake;
    },
    onOutput: () => {},
    onExit: () => {},
    graceMs: 10,
    watchWindowMs: 1000,
  });
  hub.open("card-1", { cwd: "/tmp", cols: 80, rows: 24 });
  hub.attach("client-A", "card-1");
  hub.heartbeat("client-A", "card-1");
  expect(hub.isWatched("card-1")).toBe(true);
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `cd packages/core && bun test src/terminal/__tests__/terminal-hub.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `TerminalHub` (lifecycle + watchers; permission auto-answer added in Task 5)**

```ts
// packages/core/src/terminal/terminal-hub.ts
import { log } from "../logger.js";
import type { TerminalPermissionMode } from "../schemas/config.js";
import { detectPermissionPrompt } from "./permission-detector.js";

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
  /** Factory so production passes a real PtySession and tests pass a fake. */
  createSession: (cardId: string, onData: (chunk: string) => void, onExit: (code: number) => void, opts: OpenOptions) => SessionLike;
  onOutput: (cardId: string, data: string) => void;
  onExit: (cardId: string, code: number) => void;
  /** Delay before auto-answering when unwatched. Default 1500ms. */
  graceMs?: number;
  /** A heartbeat counts as "watching" for this long. Default 6000ms. */
  watchWindowMs?: number;
}

interface SessionEntry {
  session: SessionLike;
  subscribers: Set<string>;       // clientIds attached
  lastHeartbeat: Map<string, number>; // clientId -> ts
  pendingPromptTimer: ReturnType<typeof setTimeout> | null;
  buffer: string;                 // recent tail for prompt detection
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
    if (this.sessions.has(cardId)) return; // one per card; reuse the live one
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
    this.maybeHandlePermission(cardId, e); // implemented in Task 5
  }

  private handleExit(cardId: string, code: number): void {
    const e = this.sessions.get(cardId);
    if (e?.pendingPromptTimer) clearTimeout(e.pendingPromptTimer);
    this.opts.onExit(cardId, code);
    this.sessions.delete(cardId);
  }

  // Placeholder; real logic in Task 5.
  protected maybeHandlePermission(_cardId: string, _e: SessionEntry): void {}
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/core && bun test src/terminal/__tests__/terminal-hub.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/terminal/terminal-hub.ts packages/core/src/terminal/__tests__/terminal-hub.test.ts
git commit -m "feat(core): add TerminalHub session lifecycle and watcher tracking"
```

### Task 5: TerminalHub permission auto-answer policy

**Files:**
- Modify: `packages/core/src/terminal/terminal-hub.ts`
- Modify: `packages/core/src/terminal/__tests__/terminal-hub.test.ts`

- [ ] **Step 1: Add failing tests for the three modes + grace window**

Append to `terminal-hub.test.ts`:

```ts
test("auto-unless-watching: auto-answers after grace when unwatched", async () => {
  const { fake } = makeFakeSession();
  const hub = new TerminalHub({
    permissionMode: "auto-unless-watching",
    createSession: (_c, onData) => {
      (fake as never as { _onData: (s: string) => void })._onData = onData;
      return fake;
    },
    onOutput: () => {},
    onExit: () => {},
    graceMs: 30,
    watchWindowMs: 1000,
  });
  hub.open("c1", { cwd: "/tmp", cols: 80, rows: 24 });
  (fake as never as { emit: (s: string) => void }).emit(
    "Do you want to proceed?\n❯ 1. Yes\n  3. No"
  );
  expect((fake as never as { writes: string[] }).writes).toEqual([]); // not yet
  await Bun.sleep(60);
  expect((fake as never as { writes: string[] }).writes).toEqual(["1\r"]);
});

test("auto-unless-watching: does NOT auto-answer while watched", async () => {
  const { fake } = makeFakeSession();
  const hub = new TerminalHub({
    permissionMode: "auto-unless-watching",
    createSession: (_c, onData) => {
      (fake as never as { _onData: (s: string) => void })._onData = onData;
      return fake;
    },
    onOutput: () => {},
    onExit: () => {},
    graceMs: 30,
    watchWindowMs: 1000,
  });
  hub.open("c1", { cwd: "/tmp", cols: 80, rows: 24 });
  hub.heartbeat("A", "c1");
  (fake as never as { emit: (s: string) => void }).emit("Do you want to proceed?\n❯ 1. Yes");
  await Bun.sleep(60);
  expect((fake as never as { writes: string[] }).writes).toEqual([]);
});

test("always-ask: never auto-answers", async () => {
  const { fake } = makeFakeSession();
  const hub = new TerminalHub({
    permissionMode: "always-ask",
    createSession: (_c, onData) => {
      (fake as never as { _onData: (s: string) => void })._onData = onData;
      return fake;
    },
    onOutput: () => {},
    onExit: () => {},
    graceMs: 10,
  });
  hub.open("c1", { cwd: "/tmp", cols: 80, rows: 24 });
  (fake as never as { emit: (s: string) => void }).emit("Do you want to proceed?\n❯ 1. Yes");
  await Bun.sleep(40);
  expect((fake as never as { writes: string[] }).writes).toEqual([]);
});

test("always-auto: answers immediately even when watched", async () => {
  const { fake } = makeFakeSession();
  const hub = new TerminalHub({
    permissionMode: "always-auto",
    createSession: (_c, onData) => {
      (fake as never as { _onData: (s: string) => void })._onData = onData;
      return fake;
    },
    onOutput: () => {},
    onExit: () => {},
    graceMs: 30,
  });
  hub.open("c1", { cwd: "/tmp", cols: 80, rows: 24 });
  hub.heartbeat("A", "c1");
  (fake as never as { emit: (s: string) => void }).emit("Do you want to proceed?\n❯ 1. Yes");
  await Bun.sleep(50);
  expect((fake as never as { writes: string[] }).writes).toEqual(["1\r"]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/core && bun test src/terminal/__tests__/terminal-hub.test.ts`
Expected: FAIL — the new tests fail because `maybeHandlePermission` is a no-op.

- [ ] **Step 3: Replace the placeholder `maybeHandlePermission` with the real policy**

In `terminal-hub.ts`, replace the placeholder method body:

```ts
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
    if (this.isWatched(cardId)) return;        // human is here — let them answer
    if (e.pendingPromptTimer) return;          // grace already running
    e.pendingPromptTimer = setTimeout(() => {
      e.pendingPromptTimer = null;
      if (this.isWatched(cardId)) return;      // someone showed up during grace
      answer();
    }, this.graceMs);
  }
```

Also change `private maybeHandlePermission` signature note: it replaces the earlier `protected` placeholder — make it `private` and delete the placeholder version.

- [ ] **Step 4: Run all hub tests to verify pass**

Run: `cd packages/core && bun test src/terminal/__tests__/terminal-hub.test.ts`
Expected: PASS (all cases). The `answer()` re-check uses `getScrollback()`; the fake returns `""`, so make the fake's `getScrollback` return its last emitted string. Update `makeFakeSession` so `getScrollback` returns the most recent `emit` value:

```ts
  // in makeFakeSession, track last emit:
  let last = "";
  // ...
  getScrollback: () => last,
  emit(s) { last = s; this._onData(s); },
```

(Adjust the fake accordingly and re-run until green.)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/terminal/terminal-hub.ts packages/core/src/terminal/__tests__/terminal-hub.test.ts
git commit -m "feat(core): add watcher-aware permission auto-answer policy"
```

### Task 6: Wire real PtySession into a production hub factory + barrel export

**Files:**
- Create: `packages/core/src/terminal/index.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the barrel + a production `createTerminalHub` helper**

```ts
// packages/core/src/terminal/index.ts
import { getFreshEnv } from "../executor/fresh-env.js";
import type { TerminalPermissionMode } from "../schemas/config.js";
import { PtySession } from "./pty-session.js";
import { TerminalHub } from "./terminal-hub.js";

export { PtySession } from "./pty-session.js";
export { TerminalHub } from "./terminal-hub.js";
export type { SessionLike, OpenOptions } from "./terminal-hub.js";
export { detectPermissionPrompt } from "./permission-detector.js";

/** Builds a hub that spawns real interactive `claude` PTY sessions. */
export function createTerminalHub(args: {
  permissionMode: TerminalPermissionMode;
  command: string[]; // e.g. ["claude"] or ["claude","--resume",id]
  onOutput: (cardId: string, data: string) => void;
  onExit: (cardId: string, code: number) => void;
}): TerminalHub {
  return new TerminalHub({
    permissionMode: args.permissionMode,
    onOutput: args.onOutput,
    onExit: args.onExit,
    createSession: (_cardId, onData, onExit, opts) =>
      new PtySession({
        command: args.command,
        cwd: opts.cwd,
        env: getFreshEnv(),
        cols: opts.cols,
        rows: opts.rows,
        onData,
        onExit,
      }),
  });
}
```

- [ ] **Step 2: Re-export from the core barrel**

In `packages/core/src/index.ts`, add alongside the other exports:

```ts
export * from "./terminal/index.js";
```

- [ ] **Step 3: Type-check core**

Run: `cd packages/core && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/terminal/index.ts packages/core/src/index.ts
git commit -m "feat(core): export terminal hub + production PTY factory"
```

---

## Phase 5 — Server: bidirectional WS + REST

The existing `/ws` is broadcast-only with a stub `onMessage`. Add a per-connection client id, route inbound terminal messages to a singleton hub, and broadcast hub output via the existing `broadcast()`.

### Task 7: terminal-ws module (hub singleton + message router)

**Files:**
- Create: `packages/server/src/terminal-ws.ts`
- Test: `packages/server/src/__tests__/terminal-ws.test.ts`

- [ ] **Step 1: Write the failing test** (tests the pure router, no real socket)

```ts
// packages/server/src/__tests__/terminal-ws.test.ts
import { describe, it, expect, vi } from "vitest";
import { handleTerminalMessage } from "../terminal-ws.js";
import { TerminalHub } from "@glue-paste-dev/core";

function fakeHub() {
  return {
    attach: vi.fn(),
    detach: vi.fn(),
    heartbeat: vi.fn(),
    input: vi.fn(),
    resize: vi.fn(),
  } as unknown as TerminalHub;
}

describe("handleTerminalMessage", () => {
  it("routes attach", () => {
    const hub = fakeHub();
    handleTerminalMessage(hub, "client-1", JSON.stringify({ type: "terminal:attach", cardId: "c1" }));
    expect(hub.attach).toHaveBeenCalledWith("client-1", "c1");
  });

  it("routes input", () => {
    const hub = fakeHub();
    handleTerminalMessage(hub, "client-1", JSON.stringify({ type: "terminal:input", cardId: "c1", data: "x" }));
    expect(hub.input).toHaveBeenCalledWith("c1", "x");
  });

  it("routes heartbeat and resize", () => {
    const hub = fakeHub();
    handleTerminalMessage(hub, "c-1", JSON.stringify({ type: "terminal:heartbeat", cardId: "c1" }));
    handleTerminalMessage(hub, "c-1", JSON.stringify({ type: "terminal:resize", cardId: "c1", cols: 90, rows: 30 }));
    expect(hub.heartbeat).toHaveBeenCalledWith("c-1", "c1");
    expect(hub.resize).toHaveBeenCalledWith("c1", 90, 30);
  });

  it("ignores non-terminal and malformed messages", () => {
    const hub = fakeHub();
    handleTerminalMessage(hub, "c-1", JSON.stringify({ type: "something:else" }));
    handleTerminalMessage(hub, "c-1", "not json");
    expect(hub.attach).not.toHaveBeenCalled();
    expect(hub.input).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/server && bunx vitest run src/__tests__/terminal-ws.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `terminal-ws.ts`**

```ts
// packages/server/src/terminal-ws.ts
import { createTerminalHub, getConfig, log, type TerminalHub } from "@glue-paste-dev/core";
import type { Database } from "bun:sqlite";

let hub: TerminalHub | null = null;

/** Lazily build the singleton hub; broadcast wires output back to clients. */
export function getTerminalHub(db: Database, broadcast: (e: unknown) => void): TerminalHub {
  if (hub) return hub;
  // Resolve the global permission mode once at hub creation.
  const cfg = getConfig(db, "global"); // adapt to actual config getter signature
  const permissionMode = (cfg?.terminalPermissionMode ?? "auto-unless-watching") as
    | "auto-unless-watching"
    | "always-ask"
    | "always-auto";
  hub = createTerminalHub({
    permissionMode,
    command: ["claude"],
    onOutput: (cardId, data) => broadcast({ type: "terminal:output", payload: { cardId, data } }),
    onExit: (cardId, code) => broadcast({ type: "terminal:exit", payload: { cardId, exitCode: code } }),
  });
  return hub;
}

/** Pure router: parses one inbound WS message and dispatches to the hub. */
export function handleTerminalMessage(hub: TerminalHub, clientId: string, raw: string): void {
  let msg: { type?: string; cardId?: string; data?: string; cols?: number; rows?: number };
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (!msg.type?.startsWith("terminal:") || !msg.cardId) return;
  switch (msg.type) {
    case "terminal:attach":
      hub.attach(clientId, msg.cardId);
      break;
    case "terminal:detach":
      hub.detach(clientId, msg.cardId);
      break;
    case "terminal:heartbeat":
      hub.heartbeat(clientId, msg.cardId);
      break;
    case "terminal:input":
      if (typeof msg.data === "string") hub.input(msg.cardId, msg.data);
      break;
    case "terminal:resize":
      if (typeof msg.cols === "number" && typeof msg.rows === "number") hub.resize(msg.cardId, msg.cols, msg.rows);
      break;
    default:
      log.debug("terminal-ws", `unknown terminal message ${msg.type}`);
  }
}
```

> Implementer: the `getConfig`/`getTerminalHub` config read must match the real core config API. Search `cd packages/core && grep -rn "export function getConfig\|getMergedConfig\|export function get.*Config" src` and use the correct getter; the hub only needs `terminalPermissionMode`. If reading config is awkward at hub-build time, pass `permissionMode` in from the route layer instead.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd packages/server && bunx vitest run src/__tests__/terminal-ws.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/terminal-ws.ts packages/server/src/__tests__/terminal-ws.test.ts
git commit -m "feat(server): add terminal WS message router + hub singleton"
```

### Task 8: REST routes to open/close/status a card terminal

**Files:**
- Create: `packages/server/src/routes/terminal.ts`

- [ ] **Step 1: Implement the routes** (mirrors `chatRoutes` shape: `(db, broadcast) => Hono`)

```ts
// packages/server/src/routes/terminal.ts
import { boardsDb, cardsDb, type BoardId, type CardId } from "@glue-paste-dev/core";
import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { getTerminalHub } from "../terminal-ws.js";

export function terminalRoutes(db: Database, broadcast: (e: unknown) => void) {
  const app = new Hono();

  // Open (or no-op if already running) the live terminal for a card.
  app.post("/:id/terminal", async (c) => {
    const cardId = c.req.param("id") as CardId;
    const card = cardsDb.getCard(db, cardId);
    if (!card) return c.json({ error: "Card not found" }, 404);
    const board = boardsDb.getBoard(db, card.board_id as BoardId);
    if (!board) return c.json({ error: "Board not found" }, 404);

    const hub = getTerminalHub(db, broadcast);
    const body = (await c.req.json().catch(() => ({}))) as { cols?: number; rows?: number };
    hub.open(cardId, { cwd: board.directory, cols: body.cols ?? 80, rows: body.rows ?? 24 });
    return c.json({ ok: true, running: hub.isRunning(cardId) });
  });

  // Replay scrollback + running flag (used by the client on (re)attach).
  app.get("/:id/terminal", (c) => {
    const cardId = c.req.param("id") as CardId;
    const hub = getTerminalHub(db, broadcast);
    return c.json({ running: hub.isRunning(cardId), scrollback: hub.getScrollback(cardId) });
  });

  // Kill the session.
  app.delete("/:id/terminal", (c) => {
    const cardId = c.req.param("id") as CardId;
    const hub = getTerminalHub(db, broadcast);
    hub.close(cardId);
    return c.json({ ok: true });
  });

  return app;
}
```

- [ ] **Step 2: Type-check server**

Run: `cd packages/server && bunx tsc --noEmit`
Expected: no errors. (Adjust `cardsDb.getCard`/`boardsDb.getBoard` import names to match the real exports — confirm via `grep -rn "getCard\|getBoard" packages/core/src/db`.)

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/routes/terminal.ts
git commit -m "feat(server): add REST routes to open/close/status card terminal"
```

### Task 9: Mount routes + make `/ws` bidirectional + shutdown cleanup

**Files:**
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Import and mount**

Add import near the other route imports (after line 21):

```ts
import { terminalRoutes } from "./routes/terminal.js";
import { getTerminalHub, handleTerminalMessage } from "./terminal-ws.js";
```

Mount alongside the other card routes (after line 131):

```ts
app.route("/api/cards", terminalRoutes(db, broadcast));
```

- [ ] **Step 2: Give each connection a client id and route inbound messages**

Replace the WS handler block (lines 139–154) with:

```ts
app.get(
  "/ws",
  upgradeWebSocket(() => {
    const clientId = crypto.randomUUID();
    return {
      onOpen(_event, ws) {
        const raw = ws.raw as ServerWebSocket<unknown>;
        (raw as unknown as { gpdClientId?: string }).gpdClientId = clientId;
        clients.add(raw);
        log.info("ws", `Client connected ${clientId} (${clients.size} total)`);
      },
      onMessage(event, _ws) {
        const data = typeof event.data === "string" ? event.data : "";
        if (data.includes("terminal:")) {
          handleTerminalMessage(getTerminalHub(db, broadcast), clientId, data);
        }
      },
      onClose(_event, ws) {
        clients.delete(ws.raw as ServerWebSocket<unknown>);
        getTerminalHub(db, broadcast).detachClientEverywhere(clientId);
        log.info("ws", `Client disconnected ${clientId} (${clients.size} total)`);
      },
    };
  })
);
```

- [ ] **Step 3: Kill sessions on shutdown**

In `gracefulShutdown()` (after line 187 `killAllChatProcesses();`), add:

```ts
  getTerminalHub(db, broadcast).closeAll();
```

- [ ] **Step 4: Type-check + run the existing server suite (no regressions)**

Run: `cd packages/server && bunx tsc --noEmit && bunx vitest run`
Expected: type-check clean; existing tests still pass.

- [ ] **Step 5: Manual smoke (real PTY)**

Run the server (`cd packages/server && bun run …` per the repo's dev script), then from another shell:
`curl -s -XPOST localhost:4242/api/cards/<realCardId>/terminal -H 'content-type: application/json' -d '{"cols":80,"rows":24}'`
Expected: `{"ok":true,"running":true}`. Then `curl -s localhost:4242/api/cards/<realCardId>/terminal` shows scrollback growing with the `claude` banner. Confirm via logs that a PTY spawned in the board directory.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat(server): bidirectional /ws for terminal + mount terminal routes"
```

---

## Phase 6 — Dashboard: outbound WS, API, hook, xterm component, tab

### Task 10: outbound WS send

**Files:**
- Modify: `packages/dashboard/src/lib/ws.ts`

- [ ] **Step 1: Add a failing test** (extend the existing `src/__tests__/ws.test.tsx` pattern)

```ts
// add to packages/dashboard/src/__tests__/ws.test.tsx
import { sendWS } from "../lib/ws";

it("sendWS writes JSON to the open socket", () => {
  // The test harness's mock WebSocket should record .send calls.
  // Arrange a connected socket (reuse the file's existing mock setup), then:
  const ok = sendWS({ type: "terminal:input", cardId: "c1", data: "x" });
  expect(ok).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/dashboard && bunx vitest run src/__tests__/ws.test.tsx`
Expected: FAIL — `sendWS` not exported.

- [ ] **Step 3: Implement `sendWS`** (add to `ws.ts`, using the module's existing socket reference)

```ts
// in packages/dashboard/src/lib/ws.ts
// `socket` is the module-level WebSocket created in connect(); reuse it.
export function sendWS(message: unknown): boolean {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
    return true;
  }
  return false;
}
```

> Implementer: match the actual variable name for the live socket in `ws.ts` (the explore notes call out the connection at ws.ts:21-27). If the socket is stored under a different identifier, use that.

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/dashboard && bunx vitest run src/__tests__/ws.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/lib/ws.ts packages/dashboard/src/__tests__/ws.test.tsx
git commit -m "feat(dashboard): add outbound sendWS for terminal input"
```

### Task 11: API client methods

**Files:**
- Modify: `packages/dashboard/src/lib/api.ts`

- [ ] **Step 1: Add `terminal` methods** (mirror the `chat` object near api.ts:180-191)

```ts
// in packages/dashboard/src/lib/api.ts, alongside `chat`
export const terminal = {
  open: (cardId: string, size: { cols: number; rows: number }) =>
    request<{ ok: boolean; running: boolean }>(`/cards/${cardId}/terminal`, {
      method: "POST",
      body: JSON.stringify(size),
    }),
  status: (cardId: string) =>
    request<{ running: boolean; scrollback: string }>(`/cards/${cardId}/terminal`),
  close: (cardId: string) =>
    request<{ ok: boolean }>(`/cards/${cardId}/terminal`, { method: "DELETE" }),
};
```

If `api.ts` exports a single `api` object, add `terminal` as a property there to match the existing call style (`chatApi`/`api.chat`); follow whichever the file uses.

- [ ] **Step 2: Type-check**

Run: `cd packages/dashboard && bunx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/lib/api.ts
git commit -m "feat(dashboard): add terminal REST client methods"
```

### Task 12: `use-terminal` hook

**Files:**
- Create: `packages/dashboard/src/hooks/use-terminal.ts`

- [ ] **Step 1: Implement the hook** (lifecycle: open → attach → stream → heartbeat while visible)

```ts
// packages/dashboard/src/hooks/use-terminal.ts
import { useCallback, useEffect, useRef } from "react";
import { terminal as terminalApi } from "../lib/api";
import { sendWS, useWebSocket } from "../lib/ws";

export interface UseTerminalArgs {
  cardId: string;
  active: boolean; // tab is mounted/visible
  onData: (data: string) => void;
  onExit?: (code: number) => void;
}

export function useTerminal({ cardId, active, onData, onExit }: UseTerminalArgs) {
  const onDataRef = useRef(onData);
  onDataRef.current = onData;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  // Receive output / exit for THIS card.
  useWebSocket(
    useCallback(
      (event: { type: string; payload: { cardId: string; data?: string; exitCode?: number } }) => {
        if (event.payload?.cardId !== cardId) return;
        if (event.type === "terminal:output" && event.payload.data) onDataRef.current(event.payload.data);
        if (event.type === "terminal:exit") onExitRef.current?.(event.payload.exitCode ?? 0);
      },
      [cardId]
    )
  );

  // Open + attach + replay scrollback when activated.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    (async () => {
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
  useEffect(() => {
    if (!active) return;
    const beat = () => {
      if (document.visibilityState === "visible") sendWS({ type: "terminal:heartbeat", cardId });
    };
    beat();
    const id = setInterval(beat, 3000);
    return () => clearInterval(id);
  }, [cardId, active]);

  const sendInput = useCallback((data: string) => sendWS({ type: "terminal:input", cardId, data }), [cardId]);
  const sendResize = useCallback((cols: number, rows: number) => sendWS({ type: "terminal:resize", cardId, cols, rows }), [cardId]);

  return { sendInput, sendResize };
}
```

> The heartbeat interval (3s) must be shorter than the server's `watchWindowMs` (6s) so a visible tab always counts as watched.

- [ ] **Step 2: Type-check**

Run: `cd packages/dashboard && bunx tsc -b`
Expected: no errors. (Adjust `useWebSocket` import/signature to the real `ws.ts` API — the explore notes it as `useWebSocket(listener)` firing for all events.)

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/hooks/use-terminal.ts
git commit -m "feat(dashboard): add use-terminal hook (attach, stream, heartbeat)"
```

### Task 13: `InteractiveTerminal` xterm component

**Files:**
- Create: `packages/dashboard/src/components/board/InteractiveTerminal.tsx`
- Test: `packages/dashboard/src/components/board/__tests__/InteractiveTerminal.test.tsx`

- [ ] **Step 1: Write a render smoke test** (xterm needs a DOM container; jsdom is configured)

```tsx
// packages/dashboard/src/components/board/__tests__/InteractiveTerminal.test.tsx
import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { InteractiveTerminal } from "../InteractiveTerminal";

vi.mock("../../../hooks/use-terminal", () => ({
  useTerminal: () => ({ sendInput: vi.fn(), sendResize: vi.fn() }),
}));

describe("InteractiveTerminal", () => {
  it("mounts without crashing", () => {
    const { container } = render(<InteractiveTerminal cardId="c1" active />);
    expect(container.querySelector(".gpd-xterm")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/dashboard && bunx vitest run src/components/board/__tests__/InteractiveTerminal.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

```tsx
// packages/dashboard/src/components/board/InteractiveTerminal.tsx
import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import { useTerminal } from "../../hooks/use-terminal";

export function InteractiveTerminal({ cardId, active }: { cardId: string; active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sendRef = useRef<{ sendInput: (d: string) => void; sendResize: (c: number, r: number) => void }>({
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
    const term = new Terminal({ convertEol: false, fontSize: 13, cursorBlink: true, theme: { background: "#0b0b0c" } });
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

  return <div ref={containerRef} className="gpd-xterm h-full w-full overflow-hidden rounded bg-[#0b0b0c]" />;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/dashboard && bunx vitest run src/components/board/__tests__/InteractiveTerminal.test.tsx`
Expected: PASS. (If xterm's `open()` throws in jsdom, guard the render test by asserting the container div exists and mock `xterm` similarly to `use-terminal`; keep the real component code unchanged.)

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/components/board/InteractiveTerminal.tsx packages/dashboard/src/components/board/__tests__/InteractiveTerminal.test.tsx
git commit -m "feat(dashboard): add InteractiveTerminal xterm component"
```

### Task 14: add the "Live" sub-tab in CardDialog

**Files:**
- Modify: `packages/dashboard/src/components/board/CardDialog.tsx`

- [ ] **Step 1: Extend the conversation sub-tab state**

Find the sub-tab state (explore notes the terminal/activity selector around CardDialog.tsx:1083-1087 and the persisted value `"card-dialog-activity-tab"`). Add `"live"` to the union and the button row. Concretely:

- Where the sub-tab type is declared, change e.g. `"terminal" | "activity"` → `"terminal" | "activity" | "live"`.
- In the button row, add a third button using the same `activityTabButton(...)` helper (CardDialog.tsx:363-376): `{activityTabButton("live", "Live")}`.
- In `renderActivityTabBody` (CardDialog.tsx:378-398), add a branch:

```tsx
{activitySubTab === "live" && (
  <InteractiveTerminal cardId={card.id} active={activitySubTab === "live"} />
)}
```

- Add the import at the top: `import { InteractiveTerminal } from "./InteractiveTerminal";`

> Use the real variable names from the file (the sub-tab state setter and the persisted-key value). Pass `active` so the hook only opens/heartbeats when the Live tab is the selected one.

- [ ] **Step 2: Type-check + run dashboard suite**

Run: `cd packages/dashboard && bunx tsc -b && bunx vitest run`
Expected: type-check clean; tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/components/board/CardDialog.tsx
git commit -m "feat(dashboard): add Live terminal sub-tab to CardDialog"
```

---

## Phase 7 — End-to-end verification

### Task 15: manual E2E (real CLI, real billing path)

**Files:** none (verification only).

- [ ] **Step 1: Build/run the app the normal way** (per repo: build dashboard → `../server/public`, run the Bun server, or the Electron build). Open a card whose board directory is a real git repo.

- [ ] **Step 2: Open the Live tab** — confirm the interactive `claude` TUI renders in xterm (not the `-p` view), in the correct repo directory.

- [ ] **Step 3: Type a prompt that triggers an edit, keep the tab focused** — confirm the permission prompt appears and is NOT auto-answered (you answer it). This proves "ask when watching".

- [ ] **Step 4: Trigger another edit, then switch away** (different tab/app so `visibilityState !== "visible"`). Wait past the grace window (~1.5s) — confirm the prompt is auto-answered and work proceeds. This proves "auto when not watching".

- [ ] **Step 5: Switch config to `always-ask`** and repeat Step 4 — confirm it now waits forever. Switch to `always-auto` and confirm it answers even while watching. (Restart the server if the hub caches the mode at creation; if so, note that mode changes require a session restart — acceptable for v1.)

- [ ] **Step 6: Detach/reattach** — close the dialog and reopen the Live tab; confirm scrollback replays and the session is still alive (proves persistence across tab close).

- [ ] **Step 7: Full type-check + test sweep**

```bash
cd packages/core && bunx tsc --noEmit && bun test
cd ../server && bunx tsc --noEmit && bunx vitest run
cd ../dashboard && bunx tsc -b && bunx vitest run
```
Expected: all clean/green.

- [ ] **Step 8: Commit any fixups found during E2E, then this phase is done.**

---

## Out of scope (v1)

- Non-`claude` providers in the live terminal (the hub hardcodes `["claude"]`; generalise later via the CLI adapter).
- Resuming a dead session's conversation history (`--resume`) — v1 keeps the session alive in-memory; if it dies, the user reopens fresh.
- Windows support (Bun PTY is POSIX-only).
- Per-client output fan-out (v1 broadcasts terminal output to all clients; they filter by cardId — fine for a local single-user app).
- Live config-mode changes without restart.

## Self-review notes (author)

- **Spec coverage:** real terminal in repo dir (Task 1, 6, 8), type+send prompt (Task 12/13), keep running while working (in-memory hub + scrollback, Task 4/15-step6), avoid `-p` (interactive `claude`, Task 0/6), hybrid/beside existing pipeline (no edits to runner.ts/chat.ts; new tab), permissions auto-default + ask-when-watching (Task 5, config Task 3, heartbeat Task 12). All covered.
- **Placeholder scan:** the only deliberately-deferred literal is the permission-prompt regex/keystroke, which is a *data dependency* resolved by the Phase 0 gate, not a hand-wave; the plan sequences it correctly.
- **Type consistency:** `TerminalPermissionMode` used in config (Task 3), hub (Task 4/5), factory (Task 6), server (Task 7). WS message shapes (`terminal:attach/detach/heartbeat/input/resize/output/exit`) are identical across server router (Task 7), index wiring (Task 9), and dashboard hook (Task 12). `SessionLike` defined Task 4, consumed Task 6.

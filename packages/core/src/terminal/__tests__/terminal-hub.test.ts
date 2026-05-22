import { test, expect } from "bun:test";
import { TerminalHub, type SessionLike } from "../terminal-hub.js";

type FakeSession = SessionLike & {
  emit: (s: string) => void;
  fireExit: (c: number) => void;
  _onData: (s: string) => void;
  writes: string[];
};

function makeFakeSession() {
  const writes: string[] = [];
  let last = "";
  let onExit: ((c: number) => void) | undefined;
  const fake: FakeSession = {
    write: (d: string) => writes.push(d),
    resize: () => {},
    kill: () => {},
    getScrollback: () => last,
    isRunning: () => true,
    _onData: () => {},
    emit(this: FakeSession, s: string) {
      last = s;
      this._onData(s);
    },
    fireExit(c: number) {
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
      fake._onData = onData;
      return fake;
    },
    onOutput: (cardId, data) => outputs.push({ cardId, data }),
    onExit: () => {},
    graceMs: 10,
  });

  hub.open("card-1", { cwd: "/tmp", cols: 80, rows: 24 });
  hub.attach("client-A", "card-1");
  fake.emit("hi from cli");

  expect(outputs).toEqual([{ cardId: "card-1", data: "hi from cli" }]);
  expect(hub.isWatched("card-1")).toBe(false); // attached but no heartbeat yet
});

test("heartbeat within window marks card as watched", () => {
  const { fake } = makeFakeSession();
  const hub = new TerminalHub({
    permissionMode: "auto-unless-watching",
    createSession: (_c, onData) => {
      fake._onData = onData;
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

test("auto-unless-watching: auto-answers after grace when unwatched", async () => {
  const { fake } = makeFakeSession();
  const hub = new TerminalHub({
    permissionMode: "auto-unless-watching",
    createSession: (_c, onData) => {
      fake._onData = onData;
      return fake;
    },
    onOutput: () => {},
    onExit: () => {},
    graceMs: 30,
    watchWindowMs: 1000,
  });
  hub.open("c1", { cwd: "/tmp", cols: 80, rows: 24 });
  fake.emit("Do you want to proceed?\n❯ 1. Yes\n  3. No");
  expect(fake.writes).toEqual([]); // not yet
  await Bun.sleep(60);
  expect(fake.writes).toEqual(["\r"]);
});

test("auto-unless-watching: does NOT auto-answer while watched", async () => {
  const { fake } = makeFakeSession();
  const hub = new TerminalHub({
    permissionMode: "auto-unless-watching",
    createSession: (_c, onData) => {
      fake._onData = onData;
      return fake;
    },
    onOutput: () => {},
    onExit: () => {},
    graceMs: 30,
    watchWindowMs: 1000,
  });
  hub.open("c1", { cwd: "/tmp", cols: 80, rows: 24 });
  hub.heartbeat("A", "c1");
  fake.emit("Do you want to proceed?\n❯ 1. Yes");
  await Bun.sleep(60);
  expect(fake.writes).toEqual([]);
});

test("always-ask: never auto-answers", async () => {
  const { fake } = makeFakeSession();
  const hub = new TerminalHub({
    permissionMode: "always-ask",
    createSession: (_c, onData) => {
      fake._onData = onData;
      return fake;
    },
    onOutput: () => {},
    onExit: () => {},
    graceMs: 10,
  });
  hub.open("c1", { cwd: "/tmp", cols: 80, rows: 24 });
  fake.emit("Do you want to proceed?\n❯ 1. Yes");
  await Bun.sleep(40);
  expect(fake.writes).toEqual([]);
});

test("always-auto: answers even when watched", async () => {
  const { fake } = makeFakeSession();
  const hub = new TerminalHub({
    permissionMode: "always-auto",
    createSession: (_c, onData) => {
      fake._onData = onData;
      return fake;
    },
    onOutput: () => {},
    onExit: () => {},
    graceMs: 30,
  });
  hub.open("c1", { cwd: "/tmp", cols: 80, rows: 24 });
  hub.heartbeat("A", "c1");
  fake.emit("Do you want to proceed?\n❯ 1. Yes");
  await Bun.sleep(50);
  expect(fake.writes).toEqual(["\r"]);
});

test("auto-unless-watching: a watcher appearing during grace cancels the answer", async () => {
  const { fake } = makeFakeSession();
  const hub = new TerminalHub({
    permissionMode: "auto-unless-watching",
    createSession: (_c, onData) => {
      fake._onData = onData;
      return fake;
    },
    onOutput: () => {},
    onExit: () => {},
    graceMs: 50,
    watchWindowMs: 1000,
  });
  hub.open("c1", { cwd: "/tmp", cols: 80, rows: 24 });
  fake.emit("Do you want to proceed?\n❯ 1. Yes"); // unwatched → grace timer scheduled
  hub.heartbeat("A", "c1"); // watcher shows up before grace fires
  await Bun.sleep(80);
  expect(fake.writes).toEqual([]); // grace callback re-checks isWatched and skips
});

// ── New tests for Task 2 ──────────────────────────────────────────────────────

const IDLE_SAMPLE = '❯Try"createautillogging.pythat..."';

test("(a) open with command + initialInput: session created with given command and hub writes bracketed-paste then \\r", async () => {
  let capturedOpts: import("../terminal-hub.js").OpenOptions | undefined;
  const { fake } = makeFakeSession();
  const hub = new TerminalHub({
    permissionMode: "always-ask",
    createSession: (_c, onData, _onExit, opts) => {
      capturedOpts = opts;
      fake._onData = onData;
      return fake;
    },
    onOutput: () => {},
    onExit: () => {},
    initialInputDelayMs: 0,
  });

  hub.open("c1", { cwd: "/tmp", cols: 80, rows: 24, command: ["mycommand", "--flag"], initialInput: "hello world" });

  // The bracketed-paste write should happen immediately (synchronously)
  expect(fake.writes).toContainEqual("\x1b[200~hello world\x1b[201~");

  // The \r submit should happen after initialInputDelayMs (0 ms here)
  await Bun.sleep(10);
  expect(fake.writes).toContainEqual("\r");

  // The opts passed to createSession must carry the command
  expect(capturedOpts?.command).toEqual(["mycommand", "--flag"]);
});

test("(b) idle detection fires onIdle on false→true transition only, and re-arms after non-idle output", async () => {
  const idleFires: string[] = [];
  const { fake } = makeFakeSession();
  const hub = new TerminalHub({
    permissionMode: "always-ask",
    createSession: (_c, onData) => {
      fake._onData = onData;
      return fake;
    },
    onOutput: () => {},
    onExit: () => {},
    onIdle: (cardId) => idleFires.push(cardId),
  });

  // No initialInput → idleDetectionActive = true immediately
  hub.open("c1", { cwd: "/tmp", cols: 80, rows: 24 });

  // First idle sample → should fire onIdle once
  fake.emit(IDLE_SAMPLE);
  expect(idleFires).toEqual(["c1"]);

  // Second consecutive idle sample → should NOT fire again (wasIdle is still true)
  fake.emit(IDLE_SAMPLE);
  expect(idleFires).toEqual(["c1"]);

  // Non-idle output re-arms it
  fake.emit("working...");
  expect(idleFires).toEqual(["c1"]); // still just one

  // Now next idle should fire again
  fake.emit(IDLE_SAMPLE);
  expect(idleFires).toEqual(["c1", "c1"]);
});

test("(c) interrupt(cardId) writes \\x03 to the session", () => {
  const { fake } = makeFakeSession();
  const hub = new TerminalHub({
    permissionMode: "always-ask",
    createSession: (_c, onData) => {
      fake._onData = onData;
      return fake;
    },
    onOutput: () => {},
    onExit: () => {},
  });

  hub.open("c1", { cwd: "/tmp", cols: 80, rows: 24 });
  hub.interrupt("c1");
  expect(fake.writes).toContainEqual("\x03");
});

test("(j) onPermissionPending fires true on a prompt and false once the user answers via input", () => {
  const events: boolean[] = [];
  const { fake } = makeFakeSession();
  const hub = new TerminalHub({
    permissionMode: "always-ask", // no auto-answer to interfere
    createSession: (_c, onData) => {
      fake._onData = onData;
      return fake;
    },
    onOutput: () => {},
    onExit: () => {},
    onPermissionPending: (_id, pending) => events.push(pending),
  });

  hub.open("c1", { cwd: "/tmp", cols: 80, rows: 24 });
  fake.emit("Do you want to proceed?\n❯ 1. Yes\n  2. No");
  expect(events).toEqual([true]);
  hub.input("c1", "\r"); // user answers → pending clears
  expect(events).toEqual([true, false]);
});

test("(d) waitForTurnEnd resolves {reason:'idle'} when session goes idle", async () => {
  const { fake, setOnExit } = makeFakeSession();
  const hub = new TerminalHub({
    permissionMode: "always-ask",
    createSession: (_c, onData, onExit) => {
      fake._onData = onData;
      setOnExit(onExit);
      return fake;
    },
    onOutput: () => {},
    onExit: () => {},
  });

  // No initialInput → idleDetectionActive = true immediately
  hub.open("c1", { cwd: "/tmp", cols: 80, rows: 24 });

  const p = hub.waitForTurnEnd("c1");
  fake.emit(IDLE_SAMPLE);
  expect(await p).toEqual({ reason: "idle" });
});

test("(e) waitForTurnEnd resolves {reason:'exit', code} when session exits", async () => {
  const { fake, setOnExit } = makeFakeSession();
  const hub = new TerminalHub({
    permissionMode: "always-ask",
    createSession: (_c, onData, onExit) => {
      fake._onData = onData;
      setOnExit(onExit);
      return fake;
    },
    onOutput: () => {},
    onExit: () => {},
  });

  hub.open("c1", { cwd: "/tmp", cols: 80, rows: 24 });

  const p = hub.waitForTurnEnd("c1");
  fake.fireExit(1);
  expect(await p).toEqual({ reason: "exit", code: 1 });
});

test("(b-gate) idle before submit does NOT fire onIdle; idle after submit does", async () => {
  const idleFires: string[] = [];
  const { fake } = makeFakeSession();
  const hub = new TerminalHub({
    permissionMode: "always-ask",
    createSession: (_c, onData) => {
      fake._onData = onData;
      return fake;
    },
    onOutput: () => {},
    onExit: () => {},
    onIdle: (cardId) => idleFires.push(cardId),
    initialInputDelayMs: 20,
  });

  // Open WITH initialInput → idleDetectionActive = false until \r is sent
  hub.open("c1", { cwd: "/tmp", cols: 80, rows: 24, initialInput: "do something" });

  // Emit idle BEFORE the delayed \r fires → must NOT trigger onIdle
  fake.emit(IDLE_SAMPLE);
  expect(idleFires).toEqual([]);

  // Wait for the \r callback to fire (initialInputDelayMs = 20ms)
  await Bun.sleep(40);

  // Emit non-idle so wasIdle is false, then emit idle → should fire now
  fake.emit("working...");
  fake.emit(IDLE_SAMPLE);
  expect(idleFires).toEqual(["c1"]);
});

// ── Task 3: onBusy + lastActivity + LRU eviction ─────────────────────────────

type EvictionFake = SessionLike & {
  emit: (s: string) => void;
  _onData: (s: string) => void;
  writes: string[];
  killed: boolean;
};

/** Per-card fake factory for multi-session eviction tests. */
function makeSessionFactory() {
  const fakes = new Map<string, EvictionFake>();

  function createSession(
    cardId: string,
    onData: (s: string) => void
  ): SessionLike {
    const writes: string[] = [];
    let last = "";
    let running = true;
    const fake: EvictionFake = {
      write: (d: string) => { writes.push(d); },
      resize: () => {},
      kill: () => { running = false; fake.killed = true; },
      getScrollback: () => last,
      isRunning: () => running,
      killed: false,
      writes,
      _onData: onData,
      emit(s: string) {
        last = s;
        this._onData(s);
      },
    };
    fakes.set(cardId, fake);
    return fake;
  }

  return { createSession, fakes };
}

test("(f) onBusy fires on idle→busy transition only, re-arms after next idle", () => {
  const busyFires: string[] = [];
  const { fake } = makeFakeSession();
  const hub = new TerminalHub({
    permissionMode: "always-ask",
    createSession: (_c, onData) => {
      fake._onData = onData;
      return fake;
    },
    onOutput: () => {},
    onExit: () => {},
    onBusy: (cardId) => busyFires.push(cardId),
  });

  // No initialInput → idleDetectionActive = true immediately
  hub.open("c1", { cwd: "/tmp", cols: 80, rows: 24 });

  // Emit idle → wasIdle becomes true
  fake.emit(IDLE_SAMPLE);
  expect(busyFires).toEqual([]); // no busy yet

  // Emit non-idle → transition idle→busy → onBusy fires once
  fake.emit("working...");
  expect(busyFires).toEqual(["c1"]);

  // Emit another non-idle → still busy, onBusy must NOT fire again
  fake.emit("still working...");
  expect(busyFires).toEqual(["c1"]);

  // Emit idle → re-arm
  fake.emit(IDLE_SAMPLE);
  expect(busyFires).toEqual(["c1"]); // not changed

  // Emit non-idle → second idle→busy transition → fires again
  fake.emit("working again...");
  expect(busyFires).toEqual(["c1", "c1"]);
});

test("(g) LRU eviction closes oldest idle session when at capacity", () => {
  const { createSession, fakes } = makeSessionFactory();

  const hub = new TerminalHub({
    permissionMode: "always-ask",
    createSession: (cardId, onData) => createSession(cardId, onData),
    onOutput: () => {},
    onExit: () => {},
    maxSessions: 2,
  });

  // Open c1 and make it idle
  hub.open("c1", { cwd: "/tmp", cols: 80, rows: 24 });
  fakes.get("c1")!.emit(IDLE_SAMPLE);

  // Small delay to ensure c2 has a newer lastActivity than c1
  // (both go idle but c1 was opened/emitted first)
  // Open c2 and make it idle
  hub.open("c2", { cwd: "/tmp", cols: 80, rows: 24 });
  fakes.get("c2")!.emit(IDLE_SAMPLE);

  // c1 and c2 are both idle; opening c3 should evict c1 (oldest lastActivity)
  hub.open("c3", { cwd: "/tmp", cols: 80, rows: 24 });

  expect(fakes.get("c1")!.killed).toBe(true);  // c1 evicted
  expect(hub.isRunning("c1")).toBe(false);       // gone from map
  expect(hub.isRunning("c2")).toBe(true);        // still alive
  expect(hub.isRunning("c3")).toBe(true);        // newly opened
});

test("(h) LRU eviction does NOT evict working (non-idle) sessions", () => {
  const { createSession, fakes } = makeSessionFactory();

  const hub = new TerminalHub({
    permissionMode: "always-ask",
    createSession: (cardId, onData) => createSession(cardId, onData),
    onOutput: () => {},
    onExit: () => {},
    maxSessions: 2,
  });

  // Open c1 and c2 but keep them busy (never emit idle)
  hub.open("c1", { cwd: "/tmp", cols: 80, rows: 24 });
  fakes.get("c1")!.emit("busy output...");

  hub.open("c2", { cwd: "/tmp", cols: 80, rows: 24 });
  fakes.get("c2")!.emit("busy output...");

  // At cap with all working sessions → open c3 must NOT evict anyone
  hub.open("c3", { cwd: "/tmp", cols: 80, rows: 24 });

  // c3 should not open (or if it opens, c1 and c2 are untouched)
  expect(fakes.get("c1")!.killed).toBe(false);
  expect(fakes.get("c2")!.killed).toBe(false);
});

test("(i) LRU eviction skips watched sessions and evicts next-oldest idle", () => {
  const { createSession, fakes } = makeSessionFactory();

  const hub = new TerminalHub({
    permissionMode: "always-ask",
    createSession: (cardId, onData) => createSession(cardId, onData),
    onOutput: () => {},
    onExit: () => {},
    maxSessions: 2,
    watchWindowMs: 5000,
  });

  // Open c1 and make it idle
  hub.open("c1", { cwd: "/tmp", cols: 80, rows: 24 });
  fakes.get("c1")!.emit(IDLE_SAMPLE);

  // Open c2 and make it idle
  hub.open("c2", { cwd: "/tmp", cols: 80, rows: 24 });
  fakes.get("c2")!.emit(IDLE_SAMPLE);

  // Put a heartbeat on c1 (oldest) → c1 is now watched, so c2 should be evicted instead
  hub.heartbeat("client-A", "c1");

  // Open c3 → should evict c2 (next-oldest idle, unwatched) not c1
  hub.open("c3", { cwd: "/tmp", cols: 80, rows: 24 });

  expect(fakes.get("c2")!.killed).toBe(true);   // c2 evicted
  expect(fakes.get("c1")!.killed).toBe(false);  // c1 protected by heartbeat
  expect(hub.isRunning("c3")).toBe(true);
});

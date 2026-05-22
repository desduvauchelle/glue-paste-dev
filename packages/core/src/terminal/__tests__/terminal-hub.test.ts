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

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
  expect(fake.writes).toEqual(["1\r"]);
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
  expect(fake.writes).toEqual(["1\r"]);
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

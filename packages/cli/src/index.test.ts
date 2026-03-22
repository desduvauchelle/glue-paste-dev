import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";

// Mock all command modules so they don't execute real operations
mock.module("./commands/start.js", () => ({ start: mock(() => Promise.resolve()) }));
mock.module("./commands/stop.js", () => ({ stop: mock(() => Promise.resolve()) }));
mock.module("./commands/restart.js", () => ({ restart: mock(() => Promise.resolve()) }));
mock.module("./commands/status.js", () => ({ status: mock(() => Promise.resolve()) }));
mock.module("./commands/logs.js", () => ({ logs: mock(() => Promise.resolve()) }));
mock.module("./commands/open.js", () => ({ open: mock(() => Promise.resolve()) }));
mock.module("./commands/update.js", () => ({ update: mock(() => Promise.resolve()) }));
mock.module("./commands/uninstall.js", () => ({ uninstall: mock(() => Promise.resolve()) }));
mock.module("./commands/add.js", () => ({ add: mock(() => Promise.resolve()) }));

import { route } from "./index.js";

describe("route", () => {
  let originalExit: typeof process.exit;
  let originalLog: typeof console.log;
  let originalError: typeof console.error;
  let exitCode: number | undefined;
  let logOutput: string;
  let errorOutput: string;

  beforeEach(() => {
    originalExit = process.exit;
    originalLog = console.log;
    originalError = console.error;
    exitCode = undefined;
    logOutput = "";
    errorOutput = "";
    process.exit = ((code: number) => { exitCode = code; }) as never;
    console.log = ((msg: string) => { logOutput += msg; }) as never;
    console.error = ((msg: string) => { errorOutput += (errorOutput ? "\n" : "") + msg; }) as never;
  });

  afterEach(() => {
    process.exit = originalExit;
    console.log = originalLog;
    console.error = originalError;
  });

  test("unknown command exits with code 1", async () => {
    await route("bogus", []);
    expect(exitCode).toBe(1);
  });

  test("--help prints help text containing GluePasteDev", async () => {
    await route("--help", []);
    expect(logOutput).toContain("GluePasteDev");
  });

  test("-h is alias for --help", async () => {
    await route("-h", []);
    expect(logOutput).toContain("GluePasteDev");
  });

  test("undefined command prints help", async () => {
    await route(undefined, []);
    expect(logOutput).toContain("GluePasteDev");
  });

  test("help text mentions all commands", async () => {
    await route("--help", []);
    const commands = ["up", "start", "down", "stop", "restart", "status", "open", "logs", "add", "update", "uninstall"];
    for (const cmd of commands) {
      expect(logOutput).toContain(cmd);
    }
  });
});

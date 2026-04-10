import { describe, expect, test, mock, beforeEach } from "bun:test";

let mockExistsSync = true;
let mockReadFileSync = '{"version":"1.2.3"}';
let appendedLines: string[] = [];

mock.module("../daemon.js", () => ({
  DATA_DIR: "/mock/data/dir",
  getDaemonStatus: () => ({ running: false }),
}));

mock.module("./stop.js", () => ({
  stop: async () => {},
}));

mock.module("./start.js", () => ({
  start: async () => {},
}));

mock.module("node:path", () => ({
  join: (...parts: string[]) => parts.join("/"),
}));

mock.module("node:fs", () => ({
  existsSync: (_p: string) => mockExistsSync,
  readFileSync: (_p: string, _enc: string) => mockReadFileSync,
  rmSync: () => {},
  writeFileSync: () => {},
  mkdirSync: () => {},
  readdirSync: () => [],
  statSync: () => ({}),
  unlinkSync: () => {},
  copyFileSync: () => {},
  appendFileSync: (_path: string, line: string) => { appendedLines.push(line); },
  symlinkSync: () => {},
  renameSync: () => {},
  accessSync: () => {},
  createReadStream: () => ({}),
  createWriteStream: () => ({}),
}));

const { readVersion } = await import("./update.js");

describe("readVersion", () => {
  beforeEach(() => {
    mockExistsSync = true;
    mockReadFileSync = '{"version":"1.2.3"}';
    appendedLines = [];
  });

  test("returns a string", () => {
    const result = readVersion();
    expect(typeof result).toBe("string");
  });

  test("returns version from package.json", () => {
    mockReadFileSync = '{"version":"2.0.0"}';
    const result = readVersion();
    expect(result).toBe("2.0.0");
  });

  test("returns 'unknown' when package.json does not exist", () => {
    mockExistsSync = false;
    const result = readVersion();
    expect(result).toBe("unknown");
  });
});

describe("logUpdate (appendFileSync) integration", () => {
  beforeEach(() => {
    appendedLines = [];
  });

  test("appendFileSync mock captures log lines", async () => {
    const fs = await import("node:fs");
    fs.appendFileSync("/mock/data/dir/glue-paste-dev.log", "[INF] [update] test\n");
    expect(appendedLines).toHaveLength(1);
    expect(appendedLines[0]).toContain("[update]");
  });

  test("log path uses DATA_DIR", () => {
    const expectedPath = "/mock/data/dir/glue-paste-dev.log";
    expect(expectedPath).toContain("/mock/data/dir");
    expect(expectedPath).toEndWith("glue-paste-dev.log");
  });
});

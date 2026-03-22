import { describe, expect, test, mock, beforeEach } from "bun:test";

// --- Mock node:fs before importing daemon ---
const mockExistsSync = mock(() => false);
const mockReadFileSync = mock(() => "");
const mockUnlinkSync = mock(() => {});
const mockMkdirSync = mock(() => {});
const mockWriteFileSync = mock(() => {});
const mockAppendFileSync = mock(() => {});

mock.module("node:fs", () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  unlinkSync: mockUnlinkSync,
  mkdirSync: mockMkdirSync,
  writeFileSync: mockWriteFileSync,
  appendFileSync: mockAppendFileSync,
}));

import {
  timestamp,
  isAlive,
  readPid,
  getDaemonStatus,
  getServerPath,
} from "./daemon.js";

beforeEach(() => {
  mockExistsSync.mockReset();
  mockReadFileSync.mockReset();
  mockUnlinkSync.mockReset();
});

describe("timestamp", () => {
  test("returns an ISO 8601 string", () => {
    const ts = timestamp();
    const parsed = new Date(ts);
    expect(parsed.toISOString()).toBe(ts);
  });

  test("returns a recent time", () => {
    const before = Date.now();
    const ts = timestamp();
    const after = Date.now();
    const tsMs = new Date(ts).getTime();
    expect(tsMs).toBeGreaterThanOrEqual(before);
    expect(tsMs).toBeLessThanOrEqual(after);
  });
});

describe("isAlive", () => {
  test("returns true for the current process PID", () => {
    expect(isAlive(process.pid)).toBe(true);
  });

  test("returns false for a non-existent PID", () => {
    // PID 2147483647 is unlikely to exist
    expect(isAlive(2147483647)).toBe(false);
  });
});

describe("readPid", () => {
  test("returns null when PID file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(readPid()).toBeNull();
  });

  test("returns the number when file contains a valid PID", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("12345");
    expect(readPid()).toBe(12345);
  });

  test("returns the number when file has trailing whitespace", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("  99999  \n");
    expect(readPid()).toBe(99999);
  });

  test("returns null when file contains garbage", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("not-a-number");
    expect(readPid()).toBeNull();
  });

  test("returns null when file is empty", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("");
    expect(readPid()).toBeNull();
  });

  test("returns null when file contains only whitespace", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("   \n  ");
    expect(readPid()).toBeNull();
  });
});

describe("getDaemonStatus", () => {
  test("returns {running: false, pid: null} when no PID file exists", () => {
    mockExistsSync.mockReturnValue(false);
    const status = getDaemonStatus();
    expect(status).toEqual({ running: false, pid: null });
  });

  test("returns {running: true, pid} when PID file has a live process", () => {
    const currentPid = process.pid;
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(String(currentPid));
    const status = getDaemonStatus();
    expect(status).toEqual({ running: true, pid: currentPid });
  });

  test("returns {running: false, pid: null} and cleans up stale PID file", () => {
    const stalePid = 2147483647;
    // existsSync is called by readPid (for PID_FILE) and removePid (for PID_FILE)
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(String(stalePid));
    const status = getDaemonStatus();
    expect(status).toEqual({ running: false, pid: null });
    expect(mockUnlinkSync).toHaveBeenCalled();
  });
});

describe("getServerPath", () => {
  test("returns a string", () => {
    // getServerPath calls existsSync internally; mock it to return false
    // so it falls through to the dev path
    mockExistsSync.mockReturnValue(false);
    const result = getServerPath();
    expect(typeof result).toBe("string");
  });

  test("path ends with index.ts or index.js", () => {
    mockExistsSync.mockReturnValue(false);
    const result = getServerPath();
    expect(result.endsWith("index.ts") || result.endsWith("index.js")).toBe(true);
  });

  test("returns bundled path when it exists", () => {
    mockExistsSync.mockReturnValue(true);
    const result = getServerPath();
    expect(result).toContain("server");
    expect(result.endsWith("index.js")).toBe(true);
  });
});

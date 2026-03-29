import { describe, test, expect, afterEach } from "bun:test";
import { executionLogPath, writeExecutionLog, writeExecutionLogRaw } from "../../executor/execution-logger.js";
import { homedir } from "os";
import { join } from "path";
import { readFileSync, existsSync, rmSync } from "fs";

describe("executionLogPath", () => {
  test("returns path under ~/.glue-paste-dev/executions/", () => {
    const path = executionLogPath("exec-123");
    expect(path).toBe(join(homedir(), ".glue-paste-dev", "executions", "exec-123.log"));
  });

  test("uses execution ID as filename with .log extension", () => {
    const path = executionLogPath("abc-def-ghi");
    expect(path.endsWith("abc-def-ghi.log")).toBe(true);
  });
});

describe("writeExecutionLog", () => {
  const testExecId = `test-log-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  afterEach(() => {
    const path = executionLogPath(testExecId);
    try { rmSync(path, { force: true }); } catch {}
  });

  test("creates log file with timestamped line", () => {
    writeExecutionLog(testExecId, "test message");
    const path = executionLogPath(testExecId);
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf-8");
    expect(content).toMatch(/^\[.*\] test message\n$/);
  });

  test("appends multiple lines", () => {
    writeExecutionLog(testExecId, "line 1");
    writeExecutionLog(testExecId, "line 2");
    const path = executionLogPath(testExecId);
    const content = readFileSync(path, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
  });
});

describe("writeExecutionLogRaw", () => {
  const testExecId = `test-raw-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  afterEach(() => {
    const path = executionLogPath(testExecId);
    try { rmSync(path, { force: true }); } catch {}
  });

  test("writes raw data without timestamp prefix", () => {
    writeExecutionLogRaw(testExecId, "raw data here");
    const path = executionLogPath(testExecId);
    const content = readFileSync(path, "utf-8");
    expect(content).toBe("raw data here");
  });
});

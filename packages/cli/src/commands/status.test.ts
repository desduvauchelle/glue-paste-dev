import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ANSI_RE = /\x1b\[[0-9;]*m/;
const CLI_PATH = join(import.meta.dir, "..", "index.ts");

function runCli(...args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const proc = Bun.spawnSync(["bun", "run", CLI_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HOME: "/tmp/glue-paste-test-nonexistent" },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode,
  };
}

describe("status command", () => {
  test("status --json outputs valid JSON with running: false when daemon not running", () => {
    const result = runCli("status", "--json");
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed).toEqual({ running: false });
  });

  test("status without --json outputs text containing 'not running'", () => {
    const result = runCli("status");
    expect(result.stdout).toContain("not running");
  });

  test("status --json output contains no ANSI codes", () => {
    const result = runCli("status", "--json");
    expect(result.stdout).not.toMatch(ANSI_RE);
  });

  test("status --json output is parseable as valid JSON", () => {
    const result = runCli("status", "--json");
    expect(() => JSON.parse(result.stdout.trim())).not.toThrow();
  });

  test("status plain output uses ANSI codes for formatting", () => {
    const result = runCli("status");
    expect(result.stdout).toMatch(ANSI_RE);
  });
});

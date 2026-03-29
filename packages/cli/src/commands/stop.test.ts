import { describe, test, expect } from "bun:test";
import { join } from "node:path";

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

describe("stop command", () => {
  test("reports not running when daemon is not active", () => {
    const result = runCli("stop");
    expect(result.stdout).toContain("not running");
  });
});

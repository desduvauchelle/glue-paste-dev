import { describe, expect, test } from "bun:test";
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

describe("uninstall", () => {
  test("without --yes, prints confirmation and does not uninstall", () => {
    const result = runCli("uninstall");
    expect(result.stdout).toContain("--yes");
  });

  test("without --yes, shows --keep-data hint", () => {
    const result = runCli("uninstall");
    expect(result.stdout).toContain("--keep-data");
  });

  test("without --yes, shows example commands", () => {
    const result = runCli("uninstall");
    expect(result.stdout).toContain("glue-paste-dev uninstall --yes");
    expect(result.stdout).toContain("glue-paste-dev uninstall --yes --keep-data");
  });

  test("--keep-data without --yes still only shows confirmation", () => {
    const result = runCli("uninstall", "--keep-data");
    expect(result.stdout).toContain("--yes");
  });
});

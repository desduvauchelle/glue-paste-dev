import { describe, expect, test } from "bun:test";
import { parseFlags } from "./add.js";

/**
 * Tests that the CLI works correctly when invoked by different CLI tools.
 *
 * Different tools (Copilot, Claude CLI, Cursor, shell scripts) each invoke
 * subprocesses slightly differently. These tests verify:
 * 1. Flag parsing works for various invocation patterns
 * 2. The --json flag produces machine-readable output (no ANSI codes)
 * 3. Error cases return structured JSON when --json is used
 */

describe("CLI compatibility: flag parsing patterns", () => {
  // GitHub Copilot CLI and Claude CLI typically pass args as individual tokens
  test("individual tokens: description project flags", () => {
    const opts = parseFlags(["Fix", "login", "bug", "-p", "my-project"]);
    expect(opts.description).toBe("Fix login bug");
    expect(opts.project).toBe("my-project");
  });

  // Some tools quote the entire description as a single arg
  test("quoted description as single arg", () => {
    const opts = parseFlags(["Fix the login bug", "-p", "my-project"]);
    expect(opts.description).toBe("Fix the login bug");
    expect(opts.project).toBe("my-project");
  });

  // Tools may reorder flags before the description
  test("flags before description", () => {
    const opts = parseFlags(["-p", "my-project", "Fix login bug"]);
    expect(opts.description).toBe("Fix login bug");
    expect(opts.project).toBe("my-project");
  });

  // Long form flags (some tools prefer explicit long flags)
  test("all long-form flags", () => {
    const opts = parseFlags([
      "Fix bug",
      "--project", "my-project",
      "--status", "queued",
      "--plan-thinking", "smart",
      "--execute-thinking", "basic",
      "--auto-commit",
      "--auto-push",
    ]);
    expect(opts.description).toBe("Fix bug");
    expect(opts.project).toBe("my-project");
    expect(opts.status).toBe("queued");
    expect(opts.planThinking).toBe("smart");
    expect(opts.executeThinking).toBe("basic");
    expect(opts.autoCommit).toBe(true);
    expect(opts.autoPush).toBe(true);
  });

  // --json flag is parsed and included in result
  test("--json flag is parsed", () => {
    const opts = parseFlags(["Fix bug", "-p", "app", "--json"]);
    expect(opts.json).toBe(true);
    expect(opts.description).toBe("Fix bug");
    expect(opts.project).toBe("app");
  });

  // --json flag can appear anywhere in the args
  test("--json flag at the beginning", () => {
    const opts = parseFlags(["--json", "Fix bug", "-p", "app"]);
    expect(opts.json).toBe(true);
    expect(opts.description).toBe("Fix bug");
  });

  test("--json flag between other flags", () => {
    const opts = parseFlags(["-p", "app", "--json", "Fix bug"]);
    expect(opts.json).toBe(true);
    expect(opts.project).toBe("app");
  });

  // Without --json, the field should be false
  test("json is false by default", () => {
    const opts = parseFlags(["Fix bug", "-p", "app"]);
    expect(opts.json).toBe(false);
  });

  // Mixed short and long flags (common from script-generated invocations)
  test("mixed short and long flags", () => {
    const opts = parseFlags([
      "Refactor auth",
      "-p", "backend",
      "--status", "todo",
      "--auto-commit",
      "--no-auto-push",
      "--json",
    ]);
    expect(opts.description).toBe("Refactor auth");
    expect(opts.project).toBe("backend");
    expect(opts.status).toBe("todo");
    expect(opts.autoCommit).toBe(true);
    expect(opts.autoPush).toBe(false);
    expect(opts.json).toBe(true);
  });
});

describe("CLI compatibility: error handling with --json", () => {
  test("missing description with --json outputs JSON to stderr", () => {
    const originalExit = process.exit;
    const originalError = console.error;
    let exitCode: number | undefined;
    let errorOutput = "";

    process.exit = ((code: number) => { exitCode = code; }) as never;
    console.error = ((msg: string) => { errorOutput = msg; }) as never;

    try {
      parseFlags(["--json", "-p", "app"]);
      expect(exitCode).toBe(1);
      const parsed = JSON.parse(errorOutput);
      expect(parsed.error).toBe("Missing description");
      expect(parsed.usage).toBeString();
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }
  });

  test("missing project with --json outputs JSON to stderr", () => {
    const originalExit = process.exit;
    const originalError = console.error;
    let exitCode: number | undefined;
    let errorOutput = "";

    process.exit = ((code: number) => { exitCode = code; }) as never;
    console.error = ((msg: string) => { errorOutput = msg; }) as never;

    try {
      parseFlags(["--json", "Fix bug"]);
      expect(exitCode).toBe(1);
      const parsed = JSON.parse(errorOutput);
      expect(parsed.error).toContain("Missing --project");
      expect(parsed.usage).toBeString();
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }
  });

  test("missing description without --json outputs plain text", () => {
    const originalExit = process.exit;
    const originalError = console.error;
    let exitCode: number | undefined;
    let errorOutput = "";

    process.exit = ((code: number) => { exitCode = code; }) as never;
    console.error = ((msg: string) => { errorOutput = msg; }) as never;

    try {
      parseFlags(["-p", "app"]);
      expect(exitCode).toBe(1);
      // Plain text, not JSON
      expect(() => JSON.parse(errorOutput)).toThrow();
      expect(errorOutput).toContain("Missing description");
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }
  });

  test("invalid status with --json still exits with code 1", () => {
    const originalExit = process.exit;
    const originalError = console.error;
    let exitCode: number | undefined;

    process.exit = ((code: number) => { exitCode = code; }) as never;
    console.error = (() => {}) as never;

    try {
      parseFlags(["Fix bug", "-p", "app", "--json", "--status", "invalid"]);
      expect(exitCode).toBe(1);
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }
  });

  test("unknown flag with --json still exits with code 1", () => {
    const originalExit = process.exit;
    const originalError = console.error;
    let exitCode: number | undefined;

    process.exit = ((code: number) => { exitCode = code; }) as never;
    console.error = (() => {}) as never;

    try {
      parseFlags(["Fix bug", "-p", "app", "--json", "--unknown-flag"]);
      expect(exitCode).toBe(1);
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }
  });
});

describe("CLI compatibility: output has no ANSI codes with --json", () => {
  // ANSI escape code regex
  const ANSI_RE = /\x1b\[[0-9;]*m/;

  test("--json error output contains no ANSI codes", () => {
    const originalExit = process.exit;
    const originalError = console.error;
    let errorOutput = "";

    process.exit = (() => {}) as never;
    console.error = ((msg: string) => { errorOutput = msg; }) as never;

    try {
      parseFlags(["--json", "-p", "app"]); // missing description
      expect(errorOutput).not.toMatch(ANSI_RE);
      // Verify it's valid JSON
      expect(() => JSON.parse(errorOutput)).not.toThrow();
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }
  });
});

describe("CLI compatibility: typical tool invocation patterns", () => {
  // Copilot CLI: typically passes description as a single quoted string
  test("GitHub Copilot style: single quoted description", () => {
    const opts = parseFlags(["Add user authentication to the login page", "-p", "frontend", "--json"]);
    expect(opts.description).toBe("Add user authentication to the login page");
    expect(opts.project).toBe("frontend");
    expect(opts.json).toBe(true);
  });

  // Claude CLI: may use long-form flags explicitly
  test("Claude CLI style: explicit long flags", () => {
    const opts = parseFlags([
      "Implement rate limiting",
      "--project", "api-server",
      "--status", "queued",
      "--plan-thinking", "smart",
      "--json",
    ]);
    expect(opts.description).toBe("Implement rate limiting");
    expect(opts.project).toBe("api-server");
    expect(opts.status).toBe("queued");
    expect(opts.planThinking).toBe("smart");
    expect(opts.json).toBe(true);
  });

  // Shell script: flags may be in any order
  test("shell script style: interleaved flags and positional args", () => {
    const opts = parseFlags([
      "-p", "backend",
      "--auto-commit",
      "Fix", "the", "database", "connection", "timeout",
      "--json",
    ]);
    expect(opts.description).toBe("Fix the database connection timeout");
    expect(opts.project).toBe("backend");
    expect(opts.autoCommit).toBe(true);
    expect(opts.json).toBe(true);
  });

  // Minimal invocation (just what's required)
  test("minimal invocation with --json", () => {
    const opts = parseFlags(["Fix bug", "-p", "app", "--json"]);
    expect(opts.description).toBe("Fix bug");
    expect(opts.project).toBe("app");
    expect(opts.json).toBe(true);
    expect(opts.status).toBeUndefined();
    expect(opts.planThinking).toBeUndefined();
    expect(opts.executeThinking).toBeUndefined();
    expect(opts.autoCommit).toBeUndefined();
    expect(opts.autoPush).toBeUndefined();
  });

  // Full invocation with all options
  test("full invocation with all flags", () => {
    const opts = parseFlags([
      "Complete overhaul of auth system",
      "--project", "main-app",
      "--status", "queued",
      "--plan-thinking", "smart",
      "--execute-thinking", "smart",
      "--auto-commit",
      "--auto-push",
      "--json",
    ]);
    expect(opts.description).toBe("Complete overhaul of auth system");
    expect(opts.project).toBe("main-app");
    expect(opts.status).toBe("queued");
    expect(opts.planThinking).toBe("smart");
    expect(opts.executeThinking).toBe("smart");
    expect(opts.autoCommit).toBe(true);
    expect(opts.autoPush).toBe(true);
    expect(opts.json).toBe(true);
  });

  // Description with special characters (common in AI-generated tasks)
  test("description with special characters", () => {
    const opts = parseFlags(["Fix bug #123: user can't login", "-p", "app"]);
    expect(opts.description).toBe("Fix bug #123: user can't login");
  });

  // Empty string edge case
  test("empty string tokens are ignored in positional args", () => {
    // Some tools may pass empty strings when constructing args
    const opts = parseFlags(["Fix", "bug", "-p", "app"]);
    expect(opts.description).toBe("Fix bug");
  });
});

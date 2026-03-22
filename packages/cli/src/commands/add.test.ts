import { describe, expect, test } from "bun:test";
import { parseFlags } from "./add.js";

describe("parseFlags", () => {
  test("parses description and project", () => {
    const opts = parseFlags(["Fix login bug", "-p", "my-project"]);
    expect(opts.description).toBe("Fix login bug");
    expect(opts.project).toBe("my-project");
    expect(opts.status).toBeUndefined();
  });

  test("parses --project long form", () => {
    const opts = parseFlags(["Do stuff", "--project", "app"]);
    expect(opts.project).toBe("app");
  });

  test("parses --status todo", () => {
    const opts = parseFlags(["Task", "-p", "app", "--status", "todo"]);
    expect(opts.status).toBe("todo");
  });

  test("parses --status queued", () => {
    const opts = parseFlags(["Task", "-p", "app", "-s", "queued"]);
    expect(opts.status).toBe("queued");
  });

  test("parses --plan-thinking", () => {
    const opts = parseFlags(["Task", "-p", "app", "--plan-thinking", "basic"]);
    expect(opts.planThinking).toBe("basic");
  });

  test("parses --execute-thinking", () => {
    const opts = parseFlags(["Task", "-p", "app", "--execute-thinking", "smart"]);
    expect(opts.executeThinking).toBe("smart");
  });

  test("parses --auto-commit and --auto-push", () => {
    const opts = parseFlags(["Task", "-p", "app", "--auto-commit", "--auto-push"]);
    expect(opts.autoCommit).toBe(true);
    expect(opts.autoPush).toBe(true);
  });

  test("parses --no-auto-commit and --no-auto-push", () => {
    const opts = parseFlags(["Task", "-p", "app", "--no-auto-commit", "--no-auto-push"]);
    expect(opts.autoCommit).toBe(false);
    expect(opts.autoPush).toBe(false);
  });

  test("joins multiple positional args as description", () => {
    const opts = parseFlags(["Fix", "the", "bug", "-p", "app"]);
    expect(opts.description).toBe("Fix the bug");
  });

  test("exits on missing description", () => {
    const originalExit = process.exit;
    let exitCode: number | undefined;
    process.exit = ((code: number) => { exitCode = code; }) as never;
    try {
      parseFlags(["-p", "app"]);
      expect(exitCode).toBe(1);
    } finally {
      process.exit = originalExit;
    }
  });

  test("exits on missing project", () => {
    const originalExit = process.exit;
    let exitCode: number | undefined;
    process.exit = ((code: number) => { exitCode = code; }) as never;
    try {
      parseFlags(["Some task"]);
      expect(exitCode).toBe(1);
    } finally {
      process.exit = originalExit;
    }
  });
});

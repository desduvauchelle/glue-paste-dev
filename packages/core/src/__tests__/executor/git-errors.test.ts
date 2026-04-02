import { describe, test, expect } from "bun:test";
import { detectGitError } from "../../executor/git-errors.js";

describe("detectGitError", () => {
  test("returns null when exitCode is 0", () => {
    expect(detectGitError("output", "fatal: something", 0)).toBeNull();
  });

  test("detects auth failure from stderr", () => {
    const result = detectGitError("", "fatal: Authentication failed for 'https://github.com/foo.git'", 128);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("auth");
    expect(result!.message).toContain("authentication failed");
  });

  test("detects 'could not read Username' as auth error", () => {
    const result = detectGitError("", "could not read Username for 'https://github.com': terminal prompts disabled", 128);
    expect(result!.type).toBe("auth");
  });

  test("detects SSH key failure", () => {
    const result = detectGitError("", "Permission denied (publickey).", 128);
    expect(result!.type).toBe("ssh-key");
  });

  test("detects host key verification failure", () => {
    const result = detectGitError("", "Host key verification failed.", 128);
    expect(result!.type).toBe("ssh-key");
  });

  test("detects permission denied for repo", () => {
    const result = detectGitError("", "Permission to user/repo.git denied to other-user.", 128);
    expect(result!.type).toBe("permission");
  });

  test("detects 403 Forbidden", () => {
    const result = detectGitError("", "The requested URL returned error: 403 Forbidden", 128);
    expect(result!.type).toBe("permission");
  });

  test("detects protected branch", () => {
    const result = detectGitError("", "remote: error: GH006: Protected branch update failed", 1);
    expect(result!.type).toBe("protected-branch");
  });

  test("detects push rejected non-fast-forward", () => {
    const result = detectGitError("", "! [rejected]        main -> main (non-fast-forward)", 1);
    expect(result!.type).toBe("push-rejected");
  });

  test("detects remote not found", () => {
    const result = detectGitError("", "fatal: repository 'https://github.com/foo/bar.git' not found", 128);
    expect(result!.type).toBe("remote-not-found");
  });

  test("detects merge conflict", () => {
    const result = detectGitError("CONFLICT (content): Merge conflict in file.ts", "", 1);
    expect(result!.type).toBe("merge-conflict");
  });

  test("detects detached HEAD", () => {
    const result = detectGitError("", "You are not currently on a branch.", 1);
    expect(result!.type).toBe("detached-head");
  });

  test("detects generic fatal error", () => {
    const result = detectGitError("", "fatal: not a git repository", 128);
    expect(result!.type).toBe("generic-git");
  });

  test("returns null for non-zero exit with no recognized pattern", () => {
    expect(detectGitError("some output", "some error", 1)).toBeNull();
  });

  test("checks combined stdout+stderr for patterns", () => {
    const result = detectGitError("fatal: Authentication failed", "", 128);
    expect(result!.type).toBe("auth");
  });

  test("matches first pattern when multiple could match", () => {
    const result = detectGitError("", "fatal: Authentication failed for repo", 128);
    expect(result!.type).toBe("auth");
  });
});

import { describe, test, expect } from "bun:test";
import { detectGitError } from "../../src/executor/git-errors.js";

describe("detectGitError", () => {
  test("returns null for successful execution", () => {
    expect(detectGitError("all good", "", 0)).toBeNull();
  });

  test("returns null for non-git errors", () => {
    expect(detectGitError("", "some random error", 1)).toBeNull();
  });

  test("detects authentication failure", () => {
    const stderr = "fatal: Authentication failed for 'https://github.com/user/repo.git'";
    const result = detectGitError("", stderr, 128);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("auth");
    expect(result!.message).toContain("Git authentication failed");
    expect(result!.suggestion).toContain("token");
  });

  test("detects permission denied", () => {
    const stderr = "ERROR: Permission to user/repo.git denied to bot-user.";
    const result = detectGitError("", stderr, 128);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("permission");
    expect(result!.suggestion).toContain("permission");
  });

  test("detects push rejection (non-fast-forward)", () => {
    const stderr = "! [rejected]        main -> main (non-fast-forward)\nerror: failed to push some refs";
    const result = detectGitError("", stderr, 1);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("push-rejected");
    expect(result!.suggestion).toContain("pull");
  });

  test("detects push rejection (protected branch)", () => {
    const stderr = "remote: error: GH006: Protected branch update failed";
    const result = detectGitError("", stderr, 1);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("protected-branch");
  });

  test("detects remote not found", () => {
    const stderr = "fatal: repository 'https://github.com/user/nonexistent.git/' not found";
    const result = detectGitError("", stderr, 128);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("remote-not-found");
  });

  test("detects merge conflict", () => {
    const stderr = "CONFLICT (content): Merge conflict in src/index.ts\nAutomatic merge failed; fix conflicts and then commit the result.";
    const result = detectGitError("", stderr, 1);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("merge-conflict");
  });

  test("detects detached HEAD", () => {
    const stderr = "fatal: You are not currently on a branch.";
    const result = detectGitError("", stderr, 128);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("detached-head");
  });

  test("detects SSH key issues", () => {
    const stderr = "git@github.com: Permission denied (publickey).";
    const result = detectGitError("", stderr, 128);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("ssh-key");
  });

  test("detects generic git fatal errors", () => {
    const stderr = "fatal: some unknown git error occurred";
    const result = detectGitError("", stderr, 128);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("generic-git");
  });

  test("detects git errors in stdout too (some CLIs pipe there)", () => {
    const stdout = "fatal: Authentication failed for 'https://github.com/user/repo.git'";
    const result = detectGitError(stdout, "", 1);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("auth");
  });
});

import { describe, test, expect } from "bun:test";
import { shouldFailNoChanges, buildExecutionSummary } from "../../executor/runner.js";

const SHA = "abc123def456";
const SHA_DIFFERENT = "xyz789ghi012";

describe("shouldFailNoChanges", () => {
  test("returns true when execute phase exits 0 with no file changes and same SHA", () => {
    expect(shouldFailNoChanges({
      phase: "execute",
      exitCode: 0,
      filesChanged: [],
      shaBefore: SHA,
      shaAfter: SHA,
    })).toBe(true);
  });

  test("returns false when files were changed", () => {
    expect(shouldFailNoChanges({
      phase: "execute",
      exitCode: 0,
      filesChanged: [{ path: "src/index.ts", additions: 5, deletions: 2 }],
      shaBefore: SHA,
      shaAfter: SHA,
    })).toBe(false);
  });

  test("returns false when SHA changed (uncommitted changes detected by diff)", () => {
    expect(shouldFailNoChanges({
      phase: "execute",
      exitCode: 0,
      filesChanged: [],
      shaBefore: SHA,
      shaAfter: SHA_DIFFERENT,
    })).toBe(false);
  });

  test("returns false for plan phase (plans don't produce changes)", () => {
    expect(shouldFailNoChanges({
      phase: "plan",
      exitCode: 0,
      filesChanged: [],
      shaBefore: SHA,
      shaAfter: SHA,
    })).toBe(false);
  });

  test("returns false when process exited with non-zero (already a failure)", () => {
    expect(shouldFailNoChanges({
      phase: "execute",
      exitCode: 1,
      filesChanged: [],
      shaBefore: SHA,
      shaAfter: SHA,
    })).toBe(false);
  });

  test("returns false when shaBefore is null (not a git repo)", () => {
    expect(shouldFailNoChanges({
      phase: "execute",
      exitCode: 0,
      filesChanged: [],
      shaBefore: null,
      shaAfter: null,
    })).toBe(false);
  });

  test("returns false when shaAfter is null (git command failed)", () => {
    expect(shouldFailNoChanges({
      phase: "execute",
      exitCode: 0,
      filesChanged: [],
      shaBefore: SHA,
      shaAfter: null,
    })).toBe(false);
  });
});

describe("buildExecutionSummary", () => {
  const base = {
    phaseName: "Execution",
    durationStr: "11s",
    output: "",
    stderrOutput: "",
    exitCode: 0,
  };

  test("returns no-changes message when noChangesDetected is true", () => {
    const summary = buildExecutionSummary({
      ...base,
      success: false,
      noChangesDetected: true,
    });
    expect(summary).toContain("produced no file changes");
    expect(summary).toContain("marked as failed");
    expect(summary).toContain("11s");
    expect(summary).toContain("permissions issue");
  });

  test("returns success message for normal success", () => {
    const summary = buildExecutionSummary({
      ...base,
      success: true,
      noChangesDetected: false,
    });
    expect(summary).toBe("Execution completed successfully in 11s.");
  });

  test("returns failure summary for non-zero exit code", () => {
    const summary = buildExecutionSummary({
      ...base,
      exitCode: 1,
      success: false,
      noChangesDetected: false,
      stderrOutput: "Something went wrong",
    });
    expect(summary).toContain("failed with exit code 1");
    expect(summary).toContain("Something went wrong");
  });

  test("includes git error details when present", () => {
    const summary = buildExecutionSummary({
      ...base,
      exitCode: 1,
      success: false,
      noChangesDetected: false,
      stderrOutput: "fatal: Authentication failed for 'https://github.com/foo/bar.git'",
    });
    expect(summary).toContain("Git Error");
  });

  test("uses correct phase name in messages", () => {
    const summary = buildExecutionSummary({
      ...base,
      phaseName: "Plan",
      success: true,
      noChangesDetected: false,
    });
    expect(summary).toBe("Plan completed successfully in 11s.");
  });

  test("no-changes message overrides even if success was set to false", () => {
    // When noChangesDetected is true, success should already be false,
    // but the no-changes message should take priority over generic failure
    const summary = buildExecutionSummary({
      ...base,
      success: false,
      noChangesDetected: true,
      stderrOutput: "some stderr",
    });
    expect(summary).toContain("produced no file changes");
    expect(summary).not.toContain("failed with exit code");
  });
});

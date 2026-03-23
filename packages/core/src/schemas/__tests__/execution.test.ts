import { describe, it, expect } from "bun:test";
import { ExecutionIdSchema, ExecutionPhase, ExecutionStatus, FileChangeSchema } from "../execution.js";

describe("ExecutionIdSchema", () => {
  it("accepts non-empty string", () => {
    expect(ExecutionIdSchema.safeParse("exec-1").success).toBe(true);
  });
});

describe("ExecutionPhase", () => {
  it("accepts plan", () => {
    expect(ExecutionPhase.safeParse("plan").success).toBe(true);
  });

  it("accepts execute", () => {
    expect(ExecutionPhase.safeParse("execute").success).toBe(true);
  });

  it("rejects invalid phase", () => {
    expect(ExecutionPhase.safeParse("deploy").success).toBe(false);
  });
});

describe("ExecutionStatus", () => {
  it("accepts all valid statuses", () => {
    for (const s of ["running", "success", "failed", "cancelled"]) {
      expect(ExecutionStatus.safeParse(s).success).toBe(true);
    }
  });

  it("rejects invalid status", () => {
    expect(ExecutionStatus.safeParse("pending").success).toBe(false);
  });
});

describe("FileChangeSchema", () => {
  it("accepts valid file change", () => {
    const result = FileChangeSchema.safeParse({
      path: "src/index.ts",
      additions: 10,
      deletions: 5,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing path", () => {
    const result = FileChangeSchema.safeParse({ additions: 1, deletions: 0 });
    expect(result.success).toBe(false);
  });
});

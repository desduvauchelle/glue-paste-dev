import { describe, it, expect } from "bun:test";
import {
  ConfigInputSchema,
  CliProviderSchema,
  BranchModeSchema,
  DEFAULT_CONFIG,
  CLI_PROVIDERS,
  BRANCH_MODES,
} from "../config.js";

describe("CliProviderSchema", () => {
  it("accepts all valid providers", () => {
    for (const p of CLI_PROVIDERS) {
      expect(CliProviderSchema.safeParse(p).success).toBe(true);
    }
  });

  it("rejects invalid provider", () => {
    expect(CliProviderSchema.safeParse("invalid").success).toBe(false);
  });
});

describe("BranchModeSchema", () => {
  it("accepts all valid modes", () => {
    for (const m of BRANCH_MODES) {
      expect(BranchModeSchema.safeParse(m).success).toBe(true);
    }
  });

  it("rejects invalid mode", () => {
    expect(BranchModeSchema.safeParse("invalid").success).toBe(false);
  });
});

describe("ConfigInputSchema", () => {
  it("accepts valid full config", () => {
    const result = ConfigInputSchema.safeParse({
      cliProvider: "claude",
      cliCustomCommand: "",
      model: "claude-opus-4-6",
      planModel: "",
      executeModel: "",
      maxBudgetUsd: 10,
      autoCommit: false,
      autoPush: false,
      planThinking: "smart",
      executeThinking: "smart",
      customTags: ["ux"],
      customInstructions: "",
      branchMode: "current",
      branchName: "",
    });
    expect(result.success).toBe(true);
  });

  it("accepts partial config (all fields optional)", () => {
    const result = ConfigInputSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts config with only cliProvider", () => {
    const result = ConfigInputSchema.safeParse({ cliProvider: "gemini" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid cliProvider value", () => {
    const result = ConfigInputSchema.safeParse({ cliProvider: "gpt5" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid branchMode", () => {
    const result = ConfigInputSchema.safeParse({ branchMode: "yolo" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid planThinking value", () => {
    const result = ConfigInputSchema.safeParse({ planThinking: "extreme" });
    expect(result.success).toBe(false);
  });

  it("accepts null planThinking", () => {
    const result = ConfigInputSchema.safeParse({ planThinking: null });
    expect(result.success).toBe(true);
  });

  it("rejects cliCustomCommand over 1000 chars", () => {
    const result = ConfigInputSchema.safeParse({ cliCustomCommand: "x".repeat(1001) });
    expect(result.success).toBe(false);
  });

  it("rejects customInstructions over 50000 chars", () => {
    const result = ConfigInputSchema.safeParse({ customInstructions: "x".repeat(50_001) });
    expect(result.success).toBe(false);
  });
});

describe("DEFAULT_CONFIG", () => {
  it("validates against ConfigInputSchema", () => {
    const result = ConfigInputSchema.safeParse(DEFAULT_CONFIG);
    expect(result.success).toBe(true);
  });
});

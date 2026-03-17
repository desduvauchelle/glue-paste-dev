import { describe, it, expect } from "bun:test";
import { buildCliCommand } from "../../executor/cli-adapter.js";
import { DEFAULT_CONFIG } from "../../schemas/config.js";
import type { ConfigInput } from "../../types/index.js";

function makeConfig(overrides: Partial<Required<ConfigInput>> = {}): Required<ConfigInput> {
  return { ...DEFAULT_CONFIG, customTags: [...DEFAULT_CONFIG.customTags], ...overrides };
}

describe("cli-adapter", () => {
  it("should build claude command with stream-json", () => {
    const cmd = buildCliCommand(makeConfig(), "do stuff", "sess-1", "plan");
    expect(cmd.args[0]).toBe("claude");
    expect(cmd.args).toContain("--output-format");
    expect(cmd.args).toContain("stream-json");
    expect(cmd.supportsStreamJson).toBe(true);
    expect(cmd.supportsSession).toBe(true);
  });

  it("should add --dangerously-skip-permissions in execute phase with autoConfirm", () => {
    const cmd = buildCliCommand(makeConfig({ autoConfirm: true }), "do stuff", "sess-1", "execute");
    expect(cmd.args).toContain("--dangerously-skip-permissions");
  });

  it("should not add --dangerously-skip-permissions in plan phase", () => {
    const cmd = buildCliCommand(makeConfig({ autoConfirm: true }), "do stuff", "sess-1", "plan");
    expect(cmd.args).not.toContain("--dangerously-skip-permissions");
  });

  it("should build gemini command", () => {
    const cmd = buildCliCommand(makeConfig({ cliProvider: "gemini", model: "gemini-pro" }), "do stuff", "s", "plan");
    expect(cmd.args[0]).toBe("gemini");
    expect(cmd.args).toContain("gemini-pro");
    expect(cmd.supportsStreamJson).toBe(false);
  });

  it("should build codex command", () => {
    const cmd = buildCliCommand(makeConfig({ cliProvider: "codex" }), "do stuff", "s", "plan");
    expect(cmd.args[0]).toBe("codex");
    expect(cmd.supportsStreamJson).toBe(false);
  });

  it("should build aider command", () => {
    const cmd = buildCliCommand(makeConfig({ cliProvider: "aider" }), "do stuff", "s", "plan");
    expect(cmd.args[0]).toBe("aider");
    expect(cmd.args).toContain("--message");
    expect(cmd.args).toContain("--yes");
  });

  it("should build custom command from cliCustomCommand", () => {
    const cmd = buildCliCommand(
      makeConfig({ cliProvider: "custom", cliCustomCommand: "my-tool --verbose" }),
      "do stuff", "s", "plan"
    );
    expect(cmd.args[0]).toBe("my-tool");
    expect(cmd.args[1]).toBe("--verbose");
    expect(cmd.args[2]).toBe("do stuff");
  });

  it("should throw when custom command is empty", () => {
    expect(() =>
      buildCliCommand(makeConfig({ cliProvider: "custom", cliCustomCommand: "" }), "x", "s", "plan")
    ).toThrow();
  });
});

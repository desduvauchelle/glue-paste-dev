import { describe, it, expect } from "bun:test";
import { parseStreamLine } from "./stream-parser.js";

describe("parseStreamLine", () => {
  it("parses text content blocks", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello world" }] },
    });
    const result = parseStreamLine(line);
    expect(result).toEqual({ type: "text", content: "Hello world" });
  });

  it("parses regular tool_use as [Tool: Name]", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Read" }] },
    });
    const result = parseStreamLine(line);
    expect(result).toEqual({ type: "tool_use", content: "[Tool: Read]" });
  });

  it("extracts content from Write tool_use", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Write",
            input: {
              file_path: ".claude/plans/my-plan.md",
              content: "## Plan\n1. Do X\n2. Do Y",
            },
          },
        ],
      },
    });
    const result = parseStreamLine(line);
    expect(result?.type).toBe("tool_use");
    expect(result?.content).toContain(".claude/plans/my-plan.md");
    expect(result?.content).toContain("## Plan\n1. Do X\n2. Do Y");
  });

  it("extracts new_string from Edit tool_use", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Edit",
            input: {
              file_path: "src/index.ts",
              old_string: "old code",
              new_string: "new code",
            },
          },
        ],
      },
    });
    const result = parseStreamLine(line);
    expect(result?.type).toBe("tool_use");
    expect(result?.content).toContain("src/index.ts");
    expect(result?.content).toContain("new code");
  });

  it("falls back to [Tool: Write] when content is missing", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Write", input: {} }],
      },
    });
    const result = parseStreamLine(line);
    expect(result).toEqual({ type: "tool_use", content: "[Tool: Write]" });
  });

  it("parses result events with cost", () => {
    const line = JSON.stringify({
      type: "result",
      result: "done",
      cost_usd: 0.05,
      session_id: "abc",
    });
    const result = parseStreamLine(line);
    expect(result).toEqual({
      type: "result",
      content: "done",
      costUsd: 0.05,
      sessionId: "abc",
    });
  });

  it("returns null for empty lines", () => {
    expect(parseStreamLine("")).toBeNull();
    expect(parseStreamLine("   ")).toBeNull();
  });

  it("treats non-JSON lines as raw text", () => {
    const result = parseStreamLine("some raw output");
    expect(result).toEqual({ type: "text", content: "some raw output" });
  });
});

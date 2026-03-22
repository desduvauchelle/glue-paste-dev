import { describe, test, expect } from "bun:test";
import { parseStreamLine } from "../../executor/stream-parser.js";

describe("parseStreamLine", () => {
  test("returns null for empty lines", () => {
    expect(parseStreamLine("")).toBeNull();
    expect(parseStreamLine("   ")).toBeNull();
    expect(parseStreamLine("\n")).toBeNull();
  });

  test("parses assistant text content", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hello world" }],
      },
    });

    const result = parseStreamLine(line);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("text");
    expect(result!.content).toBe("Hello world");
  });

  test("concatenates multiple text parts", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Part 1" },
          { type: "text", text: " Part 2" },
        ],
      },
    });

    const result = parseStreamLine(line);
    expect(result!.content).toBe("Part 1 Part 2");
  });

  test("parses tool_use events", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Read" }],
      },
    });

    const result = parseStreamLine(line);
    expect(result!.type).toBe("tool_use");
    expect(result!.content).toBe("[Tool: Read]");
  });

  test("parses Write tool with file content", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          name: "Write",
          input: { file_path: "/src/index.ts", content: "console.log('hi')" },
        }],
      },
    });

    const result = parseStreamLine(line);
    expect(result!.type).toBe("tool_use");
    expect(result!.content).toContain("/src/index.ts");
    expect(result!.content).toContain("console.log('hi')");
  });

  test("parses Edit tool with new_string", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          name: "Edit",
          input: { file_path: "/src/app.ts", new_string: "const x = 1;" },
        }],
      },
    });

    const result = parseStreamLine(line);
    expect(result!.type).toBe("tool_use");
    expect(result!.content).toContain("/src/app.ts");
    expect(result!.content).toContain("const x = 1;");
  });

  test("parses result events with cost and session", () => {
    const line = JSON.stringify({
      type: "result",
      result: "Task completed",
      cost_usd: 0.15,
      session_id: "sess-123",
      is_error: false,
    });

    const result = parseStreamLine(line);
    expect(result!.type).toBe("result");
    expect(result!.content).toBe("Task completed");
    expect(result!.costUsd).toBe(0.15);
    expect(result!.sessionId).toBe("sess-123");
    expect(result!.isError).toBe(false);
  });

  test("parses result events with error flag", () => {
    const line = JSON.stringify({
      type: "result",
      result: "Something failed",
      is_error: true,
    });

    const result = parseStreamLine(line);
    expect(result!.type).toBe("result");
    expect(result!.isError).toBe(true);
  });

  test("handles unknown JSON event types", () => {
    const line = JSON.stringify({ type: "system", data: "something" });
    const result = parseStreamLine(line);
    expect(result!.type).toBe("unknown");
  });

  test("handles non-JSON lines as raw text", () => {
    const result = parseStreamLine("Some raw output text");
    expect(result!.type).toBe("text");
    expect(result!.content).toBe("Some raw output text");
  });

  test("handles malformed JSON gracefully", () => {
    const result = parseStreamLine("{broken json");
    expect(result!.type).toBe("text");
    expect(result!.content).toBe("{broken json");
  });

  test("returns null for assistant message with empty content", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [] },
    });
    const result = parseStreamLine(line);
    // No text or tool_use parts, so falls through to unknown
    expect(result!.type).toBe("unknown");
  });
});

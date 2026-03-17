/** Parses Claude CLI stream-json output line by line */
export interface ParsedStreamEvent {
  type: "text" | "tool_use" | "result" | "unknown";
  content: string;
  costUsd?: number;
  sessionId?: string;
  isError?: boolean;
}

export function parseStreamLine(line: string): ParsedStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);

    if (parsed.type === "assistant" && parsed.message?.content) {
      const textParts = parsed.message.content
        .filter((c: { type: string }) => c.type === "text")
        .map((c: { text?: string }) => c.text ?? "")
        .join("");
      if (textParts) {
        return { type: "text", content: textParts };
      }

      const toolParts = parsed.message.content
        .filter((c: { type: string }) => c.type === "tool_use")
        .map((c: { name?: string }) => `[Tool: ${c.name ?? "unknown"}]`)
        .join(", ");
      if (toolParts) {
        return { type: "tool_use", content: toolParts };
      }
    }

    if (parsed.type === "result") {
      return {
        type: "result",
        content: parsed.result ?? "",
        costUsd: parsed.cost_usd,
        sessionId: parsed.session_id,
        isError: parsed.is_error,
      };
    }

    // Other event types - pass through as unknown
    return { type: "unknown", content: trimmed };
  } catch {
    // Non-JSON line - treat as raw text output
    return { type: "text", content: trimmed };
  }
}

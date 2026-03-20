import type { Database } from "bun:sqlite";
import type { Board, CardWithTags, ConfigInput, CardId, Comment } from "../types/index.js";
import * as commentsDb from "../db/comments.js";
import * as executionsDb from "../db/executions.js";
import { buildPrompt } from "./prompt.js";
import { buildCliCommand } from "./cli-adapter.js";
import { parseStreamLine } from "./stream-parser.js";
import { killProcessTreeSync } from "./process-cleanup.js";
import { log } from "../logger.js";
import { cardLabel } from "../utils/cardLabel.js";

/** Track active chat processes by cardId */
const activeChatProcesses = new Map<string, ReturnType<typeof Bun.spawn>>();

export interface ChatCallbacks {
  onOutput: (cardId: string, chunk: string) => void;
  onCompleted: (cardId: string, comment: Comment) => void;
  onCommentAdded: (comment: Comment) => void;
}

export interface ChatOptions {
  card: CardWithTags;
  board: Board;
  comments: Comment[];
  config: Required<ConfigInput>;
  mode: "plan" | "execute";
  userMessage: string;
  thinking: "smart" | "basic";
}

const THINKING_LEVEL_MODELS: Record<string, string> = {
  smart: "claude-opus-4-6",
  basic: "claude-sonnet-4-6",
};

export function killChatProcess(cardId: string): boolean {
  const proc = activeChatProcesses.get(cardId);
  if (!proc) return false;
  try {
    killProcessTreeSync(proc.pid);
  } catch {
    // process may have already exited
  }
  activeChatProcesses.delete(cardId);
  return true;
}

export function killAllChatProcesses(): void {
  for (const [cardId, proc] of activeChatProcesses) {
    try {
      killProcessTreeSync(proc.pid);
    } catch {
      // process may have already exited
    }
    activeChatProcesses.delete(cardId);
  }
}

export function hasChatProcess(cardId: string): boolean {
  return activeChatProcesses.has(cardId);
}

/**
 * Runs an interactive chat message against a card's context.
 * Saves user message as comment, streams AI response, saves AI response as comment.
 */
export async function runChat(
  db: Database,
  options: ChatOptions,
  callbacks: ChatCallbacks
): Promise<void> {
  const { card, board, comments, config, mode, userMessage, thinking } = options;
  const cardId = card.id as CardId;

  log.info("chat", `Chat message for card "${cardLabel(card)}" (${cardId}), mode=${mode}`);

  // Save user message as comment
  const userComment = commentsDb.createComment(db, cardId, {
    author: "user",
    content: userMessage,
  });
  callbacks.onCommentAdded(userComment);

  // Build chat prompt: card context + history + new user message
  const chatComments = [...comments, userComment];
  const chatConfig = {
    ...config,
    model: THINKING_LEVEL_MODELS[thinking] ?? config.model ?? "claude-opus-4-6",
  };

  // Build prompt with mode-specific instructions
  const prompt = buildChatPrompt({
    card,
    board,
    comments: chatComments,
    config: chatConfig,
    mode,
    userMessage,
  });

  // Reuse the card's last session so chat continues the same conversation
  const existingSessionId = executionsDb.getLastSessionId(db, cardId);
  const sessionId = existingSessionId ?? crypto.randomUUID();
  const resume = existingSessionId !== null;
  const cliCmd = buildCliCommand(chatConfig, prompt, sessionId, mode, resume);
  const args = cliCmd.args;

  log.debug("chat", `Spawning chat: ${args.join(" ")}`);
  const proc = Bun.spawn(args, {
    cwd: board.directory,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });

  activeChatProcesses.set(card.id, proc);

  // Stream stdout
  let output = "";
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (cliCmd.supportsStreamJson) {
          const parsed = parseStreamLine(line);
          if (parsed && (parsed.type === "text" || parsed.type === "tool_use")) {
            output += parsed.content;
            callbacks.onOutput(card.id, parsed.content);
          }
        } else if (line.trim()) {
          output += line + "\n";
          callbacks.onOutput(card.id, line + "\n");
        }
      }
    }
  } catch (err) {
    log.warn("chat", `Stream read error for card ${cardId}:`, err);
  }

  // Process remaining buffer
  if (buffer.trim()) {
    if (cliCmd.supportsStreamJson) {
      const parsed = parseStreamLine(buffer);
      if (parsed && (parsed.type === "text" || parsed.type === "tool_use")) {
        output += parsed.content;
        callbacks.onOutput(card.id, parsed.content);
      }
    } else {
      output += buffer + "\n";
      callbacks.onOutput(card.id, buffer + "\n");
    }
  }

  await proc.exited;
  activeChatProcesses.delete(card.id);

  // Save AI response as comment
  if (output.trim()) {
    const aiComment = commentsDb.createComment(db, cardId, {
      author: "ai",
      content: output.trim(),
    });
    callbacks.onCommentAdded(aiComment);
    callbacks.onCompleted(card.id, aiComment);
  } else {
    // Even if empty, signal completion
    const aiComment = commentsDb.createComment(db, cardId, {
      author: "ai",
      content: "(No response)",
    });
    callbacks.onCommentAdded(aiComment);
    callbacks.onCompleted(card.id, aiComment);
  }
}

function buildChatPrompt(ctx: {
  card: CardWithTags;
  board: Board;
  comments: Comment[];
  config: Required<ConfigInput>;
  mode: "plan" | "execute";
  userMessage: string;
}): string {
  const { card, board, comments, config, mode, userMessage } = ctx;

  // Reuse the standard prompt builder for context
  const basePrompt = buildPrompt({
    card,
    board,
    comments,
    config,
    phase: mode,
  });

  const parts = [basePrompt];

  // Add chat-specific instructions
  parts.push("");
  if (mode === "plan") {
    parts.push("## Chat Mode: Plan");
    parts.push("You are in a collaborative planning conversation with the user.");
    parts.push("Analyze, discuss, and help plan the implementation. Do NOT make any code changes.");
    parts.push("Respond conversationally to the user's message.");
  } else {
    parts.push("## Chat Mode: Execute");
    parts.push("You are in an execution conversation with the user.");
    parts.push("Implement the changes discussed. You may modify files and make code changes.");
    parts.push("Respond to the user's message and take action as requested.");
  }

  parts.push("");
  parts.push(`## User's Message`);
  parts.push(userMessage);

  return parts.join("\n");
}

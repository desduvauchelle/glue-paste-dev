import type { Board, CardWithTags, Comment, ConfigInput } from "../types/index.js";

interface PromptContext {
  card: CardWithTags;
  board: Board;
  comments: Comment[];
  config: Required<ConfigInput>;
  phase: "plan" | "execute";
  planOutput?: string | undefined;
}

export function buildPrompt(ctx: PromptContext): string {
  const { card, board, comments, config, phase, planOutput } = ctx;

  const parts: string[] = [];

  // Project context
  parts.push(`You are working on the project at: ${board.directory}`);
  parts.push(`Project: ${board.name}`);
  if (board.description) {
    parts.push(`Project description: ${board.description}`);
  }

  parts.push("");

  // Task
  parts.push(`## Task`);
  parts.push(card.title);
  parts.push("");

  if (card.description) {
    parts.push(`## Description`);
    parts.push(card.description);
    parts.push("");
  }

  // Tags
  if (card.tags.length > 0) {
    parts.push(`## Areas: ${card.tags.join(", ")}`);
    parts.push("");
  }

  // Comments (feedback history)
  if (comments.length > 0) {
    parts.push(`## History & Feedback`);
    parts.push(
      "The following is the conversation history for this task. User comments are feedback you should incorporate. System comments are outputs from previous attempts."
    );
    parts.push("");
    for (const comment of comments) {
      const label =
        comment.author === "user"
          ? "User feedback"
          : comment.author === "ai"
            ? "AI"
            : "System";
      parts.push(`**${label}:** ${comment.content}`);
    }
    parts.push("");
  }

  // Custom instructions
  if (config.customInstructions) {
    parts.push(`## Additional Instructions`);
    parts.push(config.customInstructions);
    parts.push("");
  }

  // Phase-specific instructions
  if (phase === "plan") {
    parts.push(`## Instructions`);
    parts.push(`- Analyze the task and create a detailed implementation plan`);
    parts.push(`- Identify the files that need to be created or modified`);
    parts.push(`- Consider edge cases and testing requirements`);
    parts.push(`- Follow existing code patterns and conventions in the project`);
    parts.push(`- Do NOT make any changes yet - only create the plan`);
  } else {
    if (planOutput) {
      parts.push(`## Plan from previous step`);
      parts.push(planOutput);
      parts.push("");
    }
    parts.push(`## Instructions`);
    parts.push(`- Execute the plan above`);
    parts.push(`- Implement the changes completely`);
    parts.push(`- Follow existing code patterns and conventions`);
    parts.push(`- Write tests if the project has a test framework`);
    parts.push(`- Commit your changes with a clear message when done`);
  }

  return parts.join("\n");
}

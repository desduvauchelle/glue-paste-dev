import type { Board, CardWithTags, Comment, ConfigInput } from "../types/index.js";

interface PromptContext {
  card: CardWithTags;
  board: Board;
  comments: Comment[];
  config: Required<ConfigInput>;
  phase: "plan" | "execute";
  planOutput?: string | undefined;
  attachmentPaths?: string[];
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
  if (card.title) {
    parts.push(card.title);
  }
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

  // Reference files
  if (card.files && card.files.length > 0) {
    parts.push(`## Reference Files`);
    parts.push(`Read the following files for additional context on this task:`);
    for (const filePath of card.files) {
      parts.push(`- ${filePath}`);
    }
    parts.push("");
  }

  // Attached files (uploaded screenshots, images, etc.)
  if (ctx.attachmentPaths && ctx.attachmentPaths.length > 0) {
    parts.push(`## Attached Files`);
    parts.push(`The following files have been attached for visual context. Read these files to see screenshots, images, or documents the user has provided:`);
    for (const filePath of ctx.attachmentPaths) {
      parts.push(`- ${filePath}`);
    }
    parts.push("");
  }

  // Comments (feedback history) — limit to last 50 to prevent massive prompts
  const MAX_PROMPT_COMMENTS = 50;
  const recentComments = comments.length > MAX_PROMPT_COMMENTS
    ? comments.slice(-MAX_PROMPT_COMMENTS)
    : comments;
  if (recentComments.length > 0) {
    parts.push(`## History & Feedback`);
    if (comments.length > MAX_PROMPT_COMMENTS) {
      parts.push(`(Showing last ${MAX_PROMPT_COMMENTS} of ${comments.length} comments)`);
    }
    parts.push(
      "The following is the conversation history for this task. User comments are feedback you should incorporate. System comments are outputs from previous attempts."
    );
    parts.push("");
    for (const comment of recentComments) {
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
    if (config.autoCommit) {
      parts.push(`- Commit your changes with a clear message when done`);
      parts.push(`- Do NOT add Co-authored-by trailers or any AI attribution to commits. Commits must use the user's git identity only.`);
      if (config.autoPush) {
        parts.push(`- Push your changes to the remote after committing`);
        parts.push(`- If the push fails (authentication, permissions, protected branch, etc.), stop and report the exact error so the user can fix it`);
      }
    }
    if (config.branchMode === "new" || config.branchMode === "specific") {
      parts.push(`- You are working on a dedicated branch. Do NOT switch branches.`);
    }
  }

  return parts.join("\n");
}

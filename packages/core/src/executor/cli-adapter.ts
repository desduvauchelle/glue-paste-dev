import type { ConfigInput } from "../types/index.js";

export interface CliCommand {
  /** The command and its arguments to spawn */
  args: string[];
  /** Whether this provider supports streaming JSON output */
  supportsStreamJson: boolean;
  /** Whether this provider supports session IDs */
  supportsSession: boolean;
}

/**
 * Builds the CLI command for a given provider and config.
 * Each provider maps to its own CLI binary and argument format.
 */
export function buildCliCommand(
  config: Required<ConfigInput>,
  prompt: string,
  sessionId: string,
  phase: "plan" | "execute",
  resume?: boolean
): CliCommand {
  const provider = config.cliProvider ?? "claude";

  switch (provider) {
    case "claude":
      return buildClaudeCommand(config, prompt, sessionId, phase, resume);
    case "gemini":
      return buildGeminiCommand(config, prompt);
    case "codex":
      return buildCodexCommand(config, prompt);
    case "aider":
      return buildAiderCommand(config, prompt);
    case "copilot":
      return buildCopilotCommand(config, prompt);
    case "custom":
      return buildCustomCommand(config, prompt);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unknown CLI provider: ${_exhaustive}`);
    }
  }
}

function buildClaudeCommand(
  config: Required<ConfigInput>,
  prompt: string,
  sessionId: string,
  phase: "plan" | "execute",
  resume?: boolean
): CliCommand {
  const args = [
    "claude",
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
  ];

  // Override Claude Code's default co-authoring behavior
  args.push(
    "--append-system-prompt",
    "IMPORTANT: Do not add any Co-authored-by trailers or similar attribution to git commits. All commits must be authored solely by the user's git identity. Do not modify git author or committer configuration."
  );

  if (resume) {
    args.push("--resume", sessionId);
  } else {
    args.push("--session-id", sessionId);
  }

  if (config.model) {
    args.push("--model", config.model);
  }

  if (config.maxBudgetUsd && config.maxBudgetUsd > 0) {
    args.push("--max-budget-usd", String(config.maxBudgetUsd));
  }

  if (phase === "execute") {
    args.push("--dangerously-skip-permissions");
  }

  return { args, supportsStreamJson: true, supportsSession: true };
}

function buildGeminiCommand(
  config: Required<ConfigInput>,
  prompt: string
): CliCommand {
  const args = ["gemini", "-p", prompt];

  if (config.model) {
    args.push("--model", config.model);
  }

  return { args, supportsStreamJson: false, supportsSession: false };
}

function buildCodexCommand(
  config: Required<ConfigInput>,
  prompt: string
): CliCommand {
  const args = ["codex", prompt];

  if (config.model) {
    args.push("--model", config.model);
  }

  args.push("--auto-confirm");

  return { args, supportsStreamJson: false, supportsSession: false };
}

function buildAiderCommand(
  config: Required<ConfigInput>,
  prompt: string
): CliCommand {
  const args = ["aider", "--message", prompt, "--yes"];

  if (config.model) {
    args.push("--model", config.model);
  }

  return { args, supportsStreamJson: false, supportsSession: false };
}

function buildCopilotCommand(
  _config: Required<ConfigInput>,
  prompt: string
): CliCommand {
  const args = ["gh", "copilot", "suggest", prompt];

  return { args, supportsStreamJson: false, supportsSession: false };
}

function buildCustomCommand(
  config: Required<ConfigInput>,
  prompt: string
): CliCommand {
  const customCmd = (config.cliCustomCommand ?? "").trim();
  if (!customCmd) {
    throw new Error("Custom CLI provider selected but no command configured. Set cliCustomCommand in config.");
  }

  // Split the custom command, then append the prompt
  const parts = customCmd.split(/\s+/);
  const args = [...parts, prompt];

  return { args, supportsStreamJson: false, supportsSession: false };
}

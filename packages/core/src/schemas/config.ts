import { z } from "zod";

/** Supported CLI providers */
export const CLI_PROVIDERS = [
  "claude",
  "gemini",
  "codex",
  "aider",
  "copilot",
  "custom",
] as const;

export const CliProviderSchema = z.enum(CLI_PROVIDERS);
export type CliProvider = z.infer<typeof CliProviderSchema>;

/** Provider display metadata */
export const CLI_PROVIDER_META: Record<CliProvider, { label: string; command: string; description: string }> = {
  claude: { label: "Claude Code", command: "claude", description: "Anthropic Claude CLI" },
  gemini: { label: "Gemini CLI", command: "gemini", description: "Google Gemini CLI" },
  codex: { label: "Codex CLI", command: "codex", description: "OpenAI Codex CLI" },
  aider: { label: "Aider", command: "aider", description: "Aider AI pair programming" },
  copilot: { label: "GitHub Copilot", command: "gh copilot", description: "GitHub Copilot CLI" },
  custom: { label: "Custom", command: "", description: "Custom CLI command" },
};

/** Supported branch modes */
export const BRANCH_MODES = ["current", "new", "specific"] as const;
export const BranchModeSchema = z.enum(BRANCH_MODES);
export type BranchMode = z.infer<typeof BranchModeSchema>;

export const ConfigSchema = z.object({
  key: z.string(),
  cli_provider: z.string().default("claude"),
  cli_custom_command: z.string().default(""),
  model: z.string().default("claude-opus-4-6"),
  plan_model: z.string().default(""),
  execute_model: z.string().default(""),
  max_budget_usd: z.number().default(10.0),
  auto_commit: z.boolean().default(false),
  auto_push: z.boolean().default(false),
  plan_thinking: z.string().nullable().default("smart"),
  execute_thinking: z.string().default("smart"),
  custom_tags: z.string().default("[]"),
  custom_instructions: z.string().default(""),
  branch_mode: z.string().default("current"),
  branch_name: z.string().default(""),
});

/** User-facing config shape (custom_tags as array) */
export const ConfigInputSchema = z.object({
  cliProvider: CliProviderSchema.optional(),
  cliCustomCommand: z.string().max(1000).optional(),
  model: z.string().optional(),
  planModel: z.string().optional(),
  executeModel: z.string().optional(),
  maxBudgetUsd: z.number().optional(),
  autoCommit: z.boolean().optional(),
  autoPush: z.boolean().optional(),
  planThinking: z.enum(["smart", "basic"]).nullable().optional(),
  executeThinking: z.enum(["smart", "basic"]).optional(),
  customTags: z.array(z.string()).optional(),
  customInstructions: z.string().max(50_000).optional(),
  branchMode: BranchModeSchema.optional(),
  branchName: z.string().max(200).optional(),
});

export const DEFAULT_CONFIG = {
  cliProvider: "claude" as CliProvider,
  cliCustomCommand: "",
  model: "claude-opus-4-6",
  planModel: "",
  executeModel: "",
  maxBudgetUsd: 10.0,
  autoCommit: false,
  autoPush: false,
  planThinking: "smart" as "smart" | "basic" | null,
  executeThinking: "smart" as "smart" | "basic",
  customTags: [] as string[],
  customInstructions: "",
  branchMode: "current" as BranchMode,
  branchName: "",
} as const;

import { z } from "zod";

export const ConfigSchema = z.object({
  key: z.string(),
  model: z.string().default("claude-opus-4-6"),
  max_budget_usd: z.number().default(10.0),
  auto_confirm: z.boolean().default(true),
  plan_mode: z.boolean().default(true),
  custom_tags: z.string().default("[]"),
  custom_instructions: z.string().default(""),
});

/** User-facing config shape (custom_tags as array) */
export const ConfigInputSchema = z.object({
  model: z.string().optional(),
  maxBudgetUsd: z.number().optional(),
  autoConfirm: z.boolean().optional(),
  planMode: z.boolean().optional(),
  customTags: z.array(z.string()).optional(),
  customInstructions: z.string().optional(),
});

export const DEFAULT_CONFIG = {
  model: "claude-opus-4-6",
  maxBudgetUsd: 10.0,
  autoConfirm: true,
  planMode: true,
  customTags: [] as string[],
  customInstructions: "",
} as const;

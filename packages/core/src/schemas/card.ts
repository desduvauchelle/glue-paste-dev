import { z } from "zod";
import { BoardIdSchema } from "./board.js";
import { CliProviderSchema, BranchModeSchema } from "./config.js";

export const CardIdSchema = z.string().brand<"CardId">();

export const CardStatus = z.enum([
  "todo",
  "queued",
  "in-progress",
  "done",
  "failed",
]);

export const ThinkingLevel = z.enum(["smart", "basic"]);
export const PlanThinkingLevel = z.enum(["smart", "basic", "none"]);
export const CardAssignee = z.enum(["ai", "human"]);

export const DEFAULT_TAGS = ["UX", "design", "backend", "logic"] as const;

export const CardSchema = z.object({
  id: CardIdSchema,
  board_id: BoardIdSchema,
  title: z.string().default(""),
  description: z.string().default(""),
  status: CardStatus.default("todo"),
  position: z.number().int().default(0),
  blocking: z.boolean().default(false),
  plan_thinking: PlanThinkingLevel.nullable().default(null),
  execute_thinking: ThinkingLevel.nullable().default(null),
  auto_commit: z.boolean().nullable().default(null),
  auto_push: z.boolean().nullable().default(null),
  cli_provider: CliProviderSchema.nullable().default(null),
  cli_custom_command: z.string().nullable().default(null),
  branch_mode: BranchModeSchema.nullable().default(null),
  branch_name: z.string().nullable().default(null),
  assignee: CardAssignee.default("ai"),
  created_at: z.string(),
  updated_at: z.string(),
});

export const CardWithTagsSchema = CardSchema.extend({
  tags: z.array(z.string()),
  files: z.array(z.string()),
});

export const CreateCardSchema = z.object({
  title: z.string().max(1000).optional().default(""),
  description: z.string().max(50_000).optional().default(""),
  tags: z.array(z.string()).max(50).optional().default([]),
  files: z.array(z.string()).max(200).optional().default([]),
  position: z.number().int().optional(),
  status: CardStatus.optional().default("todo"),
  blocking: z.boolean().optional().default(true),
  plan_thinking: PlanThinkingLevel.nullable().optional().default(null),
  execute_thinking: ThinkingLevel.nullable().optional().default(null),
  auto_commit: z.boolean().nullable().optional().default(null),
  auto_push: z.boolean().nullable().optional().default(null),
  cli_provider: CliProviderSchema.nullable().optional().default(null),
  cli_custom_command: z.string().max(1000).nullable().optional().default(null),
  branch_mode: BranchModeSchema.nullable().optional().default(null),
  branch_name: z.string().max(200).nullable().optional().default(null),
  assignee: CardAssignee.optional().default("ai"),
});

export const UpdateCardSchema = z.object({
  title: z.string().max(1000).optional(),
  description: z.string().max(50_000).optional(),
  tags: z.array(z.string()).max(50).optional(),
  files: z.array(z.string()).max(200).optional(),
  status: CardStatus.optional(),
  position: z.number().int().optional(),
  blocking: z.boolean().optional(),
  plan_thinking: PlanThinkingLevel.nullable().optional(),
  execute_thinking: ThinkingLevel.nullable().optional(),
  auto_commit: z.boolean().nullable().optional(),
  auto_push: z.boolean().nullable().optional(),
  cli_provider: CliProviderSchema.nullable().optional(),
  cli_custom_command: z.string().max(1000).nullable().optional(),
  branch_mode: BranchModeSchema.nullable().optional(),
  branch_name: z.string().max(200).nullable().optional(),
  assignee: CardAssignee.optional(),
});

export const MoveCardSchema = z.object({
  status: CardStatus,
  position: z.number().int(),
});

export const ReorderCardsSchema = z.array(
  z.object({
    id: CardIdSchema,
    status: CardStatus,
    position: z.number().int(),
  })
);

export const MoveCardToBoardSchema = z.object({
  board_id: z.string(),
});

export type MoveCardToBoard = z.infer<typeof MoveCardToBoardSchema>;

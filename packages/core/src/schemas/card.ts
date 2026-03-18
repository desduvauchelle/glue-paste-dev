import { z } from "zod";
import { BoardIdSchema } from "./board.js";

export const CardIdSchema = z.string().brand<"CardId">();

export const CardStatus = z.enum([
  "todo",
  "queued",
  "in-progress",
  "done",
  "failed",
]);

export const ThinkingLevel = z.enum(["smart", "basic"]);

export const DEFAULT_TAGS = ["UX", "design", "backend", "logic"] as const;

export const CardSchema = z.object({
  id: CardIdSchema,
  board_id: BoardIdSchema,
  title: z.string().min(1),
  description: z.string().default(""),
  status: CardStatus.default("todo"),
  position: z.number().int().default(0),
  blocking: z.boolean().default(false),
  plan_thinking: ThinkingLevel.nullable().default(null),
  execute_thinking: ThinkingLevel.nullable().default(null),
  auto_commit: z.boolean().nullable().default(null),
  created_at: z.string(),
  updated_at: z.string(),
});

export const CardWithTagsSchema = CardSchema.extend({
  tags: z.array(z.string()),
  files: z.array(z.string()),
});

export const CreateCardSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(""),
  tags: z.array(z.string()).optional().default([]),
  files: z.array(z.string()).optional().default([]),
  position: z.number().int().optional(),
  status: CardStatus.optional().default("todo"),
  blocking: z.boolean().optional().default(true),
  plan_thinking: ThinkingLevel.nullable().optional().default(null),
  execute_thinking: ThinkingLevel.nullable().optional().default(null),
  auto_commit: z.boolean().nullable().optional().default(null),
});

export const UpdateCardSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  files: z.array(z.string()).optional(),
  status: CardStatus.optional(),
  position: z.number().int().optional(),
  blocking: z.boolean().optional(),
  plan_thinking: ThinkingLevel.nullable().optional(),
  execute_thinking: ThinkingLevel.nullable().optional(),
  auto_commit: z.boolean().nullable().optional(),
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

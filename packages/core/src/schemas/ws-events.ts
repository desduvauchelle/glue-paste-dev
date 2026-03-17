import { z } from "zod";
import { CardWithTagsSchema } from "./card.js";
import { CommentSchema } from "./comment.js";

export const WSEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("card:updated"),
    payload: CardWithTagsSchema,
  }),
  z.object({
    type: z.literal("comment:added"),
    payload: CommentSchema,
  }),
  z.object({
    type: z.literal("execution:started"),
    payload: z.object({
      cardId: z.string(),
      executionId: z.string(),
      phase: z.enum(["plan", "execute"]),
    }),
  }),
  z.object({
    type: z.literal("execution:output"),
    payload: z.object({
      executionId: z.string(),
      chunk: z.string(),
    }),
  }),
  z.object({
    type: z.literal("execution:completed"),
    payload: z.object({
      executionId: z.string(),
      status: z.enum(["success", "failed"]),
      exitCode: z.number(),
    }),
  }),
  z.object({
    type: z.literal("queue:updated"),
    payload: z.object({
      boardId: z.string(),
      queue: z.array(z.string()),
      current: z.string().nullable(),
    }),
  }),
  z.object({
    type: z.literal("queue:stopped"),
    payload: z.object({
      boardId: z.string(),
      reason: z.string(),
    }),
  }),
  z.object({
    type: z.literal("card:deleted"),
    payload: z.object({
      cardId: z.string(),
      boardId: z.string(),
    }),
  }),
  z.object({
    type: z.literal("notification"),
    payload: z.object({
      level: z.enum(["success", "error", "info"]),
      title: z.string(),
      message: z.string(),
    }),
  }),
]);

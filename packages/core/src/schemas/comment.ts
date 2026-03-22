import { z } from "zod";
import { CardIdSchema } from "./card.js";

export const CommentIdSchema = z.string().brand<"CommentId">();

export const CommentAuthor = z.enum(["user", "system", "ai"]);

export const CommentSchema = z.object({
  id: CommentIdSchema,
  card_id: CardIdSchema,
  author: CommentAuthor,
  content: z.string().min(1),
  execution_id: z.string().nullable().default(null),
  created_at: z.string(),
});

export const CreateCommentSchema = z.object({
  author: CommentAuthor.default("user"),
  content: z.string().min(1).max(50_000),
  execution_id: z.string().nullable().optional().default(null),
});

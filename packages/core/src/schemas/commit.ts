import { z } from "zod";
import { CardIdSchema } from "./card.js";
import { ExecutionIdSchema } from "./execution.js";

export const CommitIdSchema = z.string().brand<"CommitId">();

export const CardCommitSchema = z.object({
  id: CommitIdSchema,
  card_id: CardIdSchema,
  execution_id: ExecutionIdSchema.nullable(),
  sha: z.string(),
  message: z.string().default(""),
  author_name: z.string().default(""),
  author_email: z.string().default(""),
  files_changed: z.string().nullable().default(null),
  created_at: z.string(),
});

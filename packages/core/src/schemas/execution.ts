import { z } from "zod";
import { CardIdSchema } from "./card.js";

export const ExecutionIdSchema = z.string().brand<"ExecutionId">();

export const ExecutionPhase = z.enum(["plan", "execute"]);

export const ExecutionStatus = z.enum([
  "running",
  "success",
  "failed",
  "cancelled",
]);

export const FileChangeSchema = z.object({
  path: z.string(),
  additions: z.number(),
  deletions: z.number(),
});

export const ExecutionSchema = z.object({
  id: ExecutionIdSchema,
  card_id: CardIdSchema,
  session_id: z.string().nullable(),
  phase: ExecutionPhase.default("plan"),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  status: ExecutionStatus.default("running"),
  output: z.string().default(""),
  cost_usd: z.number().default(0),
  exit_code: z.number().int().nullable(),
  retry_count: z.number().int().default(0),
  pid: z.number().int().nullable(),
  files_changed: z.string().nullable().default(null),
});

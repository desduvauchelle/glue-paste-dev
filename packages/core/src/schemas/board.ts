import { z } from "zod";

export const BoardIdSchema = z.string().brand<"BoardId">();

export const BoardSchema = z.object({
  id: BoardIdSchema,
  name: z.string().min(1),
  description: z.string().default(""),
  directory: z.string().min(1),
  session_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const CreateBoardSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().default(""),
  directory: z.string().min(1),
});

export const UpdateBoardSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  directory: z.string().min(1).optional(),
});

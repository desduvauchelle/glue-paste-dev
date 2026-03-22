import { z } from "zod";

export const BoardIdSchema = z.string().brand<"BoardId">();

const SlugSchema = z
  .string()
  .regex(
    /^[a-z0-9_-]+$/,
    "Slug must contain only lowercase letters, numbers, hyphens, and underscores"
  )
  .nullable();

const AbsolutePathSchema = z.string().min(1).refine(
  (dir) => (dir.startsWith("/") || /^[a-zA-Z]:[/\\]/.test(dir)) && !dir.includes(".."),
  { message: "Directory must be an absolute path without '..' segments" }
);

export const BoardSchema = z.object({
  id: BoardIdSchema,
  name: z.string().min(1),
  description: z.string().default(""),
  directory: AbsolutePathSchema,
  color: z.string().nullable().default(null),
  scratchpad: z.string().default(""),
  slug: SlugSchema.default(null),
  session_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const CreateBoardSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().default(""),
  directory: AbsolutePathSchema,
  color: z.string().nullable().optional(),
  slug: SlugSchema.optional(),
});

export const UpdateBoardSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  directory: AbsolutePathSchema.optional(),
  color: z.string().nullable().optional(),
  scratchpad: z.string().optional(),
  slug: SlugSchema.optional(),
});

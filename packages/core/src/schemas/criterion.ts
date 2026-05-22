import { z } from "zod";

export const CriterionIdSchema = z.string().brand<"CriterionId">();
export const CriterionStatus = z.enum(["pending", "pass", "fail"]);
export const CriterionSource = z.enum(["ai", "user"]);

export const CriterionSchema = z.object({
  id: CriterionIdSchema,
  card_id: z.string(),
  text: z.string(),
  status: CriterionStatus.default("pending"),
  source: CriterionSource.default("ai"),
  evidence: z.string().nullable().default(null),
  execution_id: z.string().nullable().default(null),
  position: z.number().int().default(0),
  created_at: z.string(),
  updated_at: z.string(),
});

export const CreateCriterionSchema = z.object({
  text: z.string().min(1).max(2000),
});

export const UpdateCriterionSchema = z.object({
  text: z.string().min(1).max(2000).optional(),
  status: CriterionStatus.optional(),
});

export const ReorderCriteriaSchema = z.array(
  z.object({ id: CriterionIdSchema, position: z.number().int() })
);

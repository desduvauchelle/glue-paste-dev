import { z } from "zod";

export const PlanSummarySchema = z.object({
  key_files: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
});

export const BlockerSchema = z.object({
  type: z.string(),
  root_cause: z.string(),
  resolution_route: z.string(),
});

export const PlanReportSchema = z.object({
  criteria: z.array(z.string()).default([]),
  plan_summary: PlanSummarySchema,
});

export const ExecuteReportSchema = z.object({
  criteria: z
    .array(
      z.object({
        id: z.string(),
        status: z.enum(["pass", "fail"]),
        evidence: z.string().default(""),
      })
    )
    .default([]),
  completion_summary: z.string().default(""),
  blocker: BlockerSchema.nullable().default(null),
});

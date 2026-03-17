import { z } from "zod";

/** Claude stream-json output line - specific known types */
export const ClaudeAssistantEventSchema = z.object({
  type: z.literal("assistant"),
  message: z.object({
    id: z.string(),
    content: z.array(
      z.object({
        type: z.string(),
        text: z.string().optional(),
      })
    ),
    model: z.string(),
    usage: z
      .object({
        input_tokens: z.number(),
        output_tokens: z.number(),
        cache_creation_input_tokens: z.number().optional(),
        cache_read_input_tokens: z.number().optional(),
      })
      .optional(),
  }),
});

export const ClaudeResultEventSchema = z.object({
  type: z.literal("result"),
  result: z.string().optional(),
  cost_usd: z.number().optional(),
  duration_ms: z.number().optional(),
  is_error: z.boolean().optional(),
  session_id: z.string().optional(),
});

/** Union of known Claude stream event types */
export const ClaudeStreamEventSchema = z.union([
  ClaudeAssistantEventSchema,
  ClaudeResultEventSchema,
  z.object({ type: z.string() }).passthrough(),
]);

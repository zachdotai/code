import { z } from "zod";

/**
 * Discriminated parse of `NestMessage.payloadJson` for the two payload shapes
 * the chat panel renders specially. Anything that fails this parse is shown as
 * a plain audit row so a malformed or adversarial row can never sneak unknown
 * fields into render-time branches.
 */

export const feedbackRoutedPayloadSchema = z.object({
  type: z.literal("feedback_routed"),
  source: z.enum(["pr_review", "ci", "issue", "hedgehog"]),
  outcome: z.enum(["injected", "follow_up_spawned", "failed"]),
  payloadRef: z.string().min(1).max(512),
  hogletTaskId: z.string().min(1).max(64),
});
export type FeedbackRoutedPayload = z.infer<typeof feedbackRoutedPayloadSchema>;

export const prGraphRoutedPayloadSchema = z.object({
  type: z.literal("pr_graph_rebase_routed"),
  edgeId: z.string().min(1).max(64),
  outcome: z.enum(["injected", "follow_up_spawned", "failed", "broken"]),
  parentTaskId: z.string().min(1).max(64),
  childTaskId: z.string().min(1).max(64),
  note: z.string().max(2000).nullable(),
});
export type PrGraphRoutedPayload = z.infer<typeof prGraphRoutedPayloadSchema>;

function safeJsonParse(payloadJson: string | null): unknown {
  if (!payloadJson) return null;
  try {
    return JSON.parse(payloadJson);
  } catch {
    return null;
  }
}

export function parseFeedbackRoutedPayload(
  payloadJson: string | null,
): FeedbackRoutedPayload | null {
  const raw = safeJsonParse(payloadJson);
  if (raw === null) return null;
  const result = feedbackRoutedPayloadSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export function parsePrGraphRoutedPayload(
  payloadJson: string | null,
): PrGraphRoutedPayload | null {
  const raw = safeJsonParse(payloadJson);
  if (raw === null) return null;
  const result = prGraphRoutedPayloadSchema.safeParse(raw);
  return result.success ? result.data : null;
}

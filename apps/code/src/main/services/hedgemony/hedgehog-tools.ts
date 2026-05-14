import { z } from "zod";
import type { AnthropicToolDefinition } from "../llm-gateway/schemas";

/**
 * The hedgehog's Slice 6 tool list. **Intentionally tiny.** Per
 * notes/hedgemony/user-stories.md Slice 6: brood management only. No code
 * authoring, no PR graph, no goal judgment. Spawning new hoglets is also out
 * of scope — the hedgehog can only operate on hoglets already in her nest.
 *
 * `message_hoglet` is audit-only in Slice 6; Slice 7 (FeedbackRoutingService +
 * useHedgemonyPromptRouter hook) wires real prompt injection into live
 * sessions on the same channel.
 */
export const HEDGEHOG_TOOLS: AnthropicToolDefinition[] = [
  {
    name: "raise_hoglet",
    description:
      "Start a fresh TaskRun on an idle hoglet inside this nest. Use when the hoglet's latest run has terminated (completed/failed/cancelled) or no run exists. Include a short prompt explaining the next step.",
    input_schema: {
      type: "object",
      properties: {
        hoglet_id: {
          type: "string",
          description: "The id of the hoglet to raise.",
        },
        prompt: {
          type: "string",
          description:
            "Optional user message that becomes the first message of the new TaskRun. Should be concrete and concise.",
        },
      },
      required: ["hoglet_id"],
    },
  },
  {
    name: "kill_hoglet",
    description:
      "Cancel a hoglet's currently active TaskRun. Use when the hoglet is doing the wrong work or the nest goal has shifted.",
    input_schema: {
      type: "object",
      properties: {
        hoglet_id: {
          type: "string",
          description: "The id of the hoglet to kill.",
        },
        reason: {
          type: "string",
          description:
            "Why the hoglet is being killed; surfaced to the operator in the audit log.",
        },
      },
      required: ["hoglet_id", "reason"],
    },
  },
  {
    name: "message_hoglet",
    description:
      "Note an instruction you want delivered to a hoglet. In Slice 6 this writes an audit entry only — real prompt injection lands in a later slice. Use to record an intent; do not assume the hoglet will read it.",
    input_schema: {
      type: "object",
      properties: {
        hoglet_id: {
          type: "string",
          description: "The id of the hoglet the message is for.",
        },
        prompt: {
          type: "string",
          description: "The instruction body.",
        },
      },
      required: ["hoglet_id", "prompt"],
    },
  },
  {
    name: "write_audit_entry",
    description:
      "Write a compact, operator-visible audit entry to the nest chat. Use to explain why you took (or didn't take) a high-impact action.",
    input_schema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description:
            "One- or two-sentence summary of the decision/observation.",
        },
        detail: {
          type: "string",
          description:
            "Optional longer explanation. Persisted at detail visibility — operators can expand to see it.",
        },
      },
      required: ["summary"],
    },
  },
];

export type HedgehogToolName =
  | "raise_hoglet"
  | "kill_hoglet"
  | "message_hoglet"
  | "write_audit_entry";

export const raiseHogletArgs = z.object({
  hoglet_id: z.string().min(1),
  prompt: z.string().trim().min(1).max(2000).optional(),
});

export const killHogletArgs = z.object({
  hoglet_id: z.string().min(1),
  reason: z.string().trim().min(1).max(2000),
});

export const messageHogletArgs = z.object({
  hoglet_id: z.string().min(1),
  prompt: z.string().trim().min(1).max(2000),
});

export const writeAuditEntryArgs = z.object({
  summary: z.string().trim().min(1).max(2000),
  detail: z.string().trim().min(1).max(8000).optional(),
});

export type RaiseHogletArgs = z.infer<typeof raiseHogletArgs>;
export type KillHogletArgs = z.infer<typeof killHogletArgs>;
export type MessageHogletArgs = z.infer<typeof messageHogletArgs>;
export type WriteAuditEntryArgs = z.infer<typeof writeAuditEntryArgs>;

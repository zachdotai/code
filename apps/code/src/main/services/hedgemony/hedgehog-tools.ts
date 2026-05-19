import { z } from "zod";
import type { AnthropicToolDefinition } from "../llm-gateway/schemas";
import { HOGLET_PROMPT_MAX_CHARS, holdNextTrigger } from "./schemas";

/**
 * The hedgehog's tool list. Brood management (spawn, raise, kill, message,
 * audit, validation) plus Slice 8's PR-graph orchestration (link_pr_dependency,
 * unlink_pr_dependency, rebase_child). The hedgehog cannot author code —
 * these tools declare relationships and route prompts.
 *
 * `message_hoglet` emits an InjectPrompt event via the FeedbackRoutingService
 * pipeline. The renderer's useHedgemonyPromptRouter hook injects into live
 * sessions or spawns follow-up hoglets for completed ones.
 */
export const HEDGEHOG_TOOLS: AnthropicToolDefinition[] = [
  {
    name: "spawn_hoglet",
    description:
      "Create a brand-new hoglet (cloud Task) inside this nest and immediately start it. Use to decompose the nest goal into concrete work items. Each hoglet gets its own branch and worktree. Include a detailed prompt describing the work.",
    input_schema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "Detailed instructions for the new hoglet, up to 32k characters. Be specific about what to build, which files/areas to touch, and acceptance criteria.",
        },
        repository: {
          type: "string",
          description:
            "Repository slug (e.g. 'org/repo') the hoglet should work in. Required unless the nest has a primary_repository or there is exactly one entry in known_repositories — in those cases the dispatcher fills it for you. Must be a repo from known_repositories or one previously granted via request_repository_access.",
        },
        signal_report_id: {
          type: "string",
          description:
            "Optional id of the signal report this hoglet is following up on. Set this when you are spawning in response to a specific signal so the dispatcher can honor any operator suppression of that report.",
        },
      },
      required: ["prompt"],
    },
  },
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
      "Send an instruction to a hoglet. If the hoglet has a live session, the prompt is injected immediately. If the session has ended, a follow-up hoglet may be spawned with the prompt. Use for mid-flight course corrections or new context the hoglet needs. Do not use this to stand down or terminate a run.",
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
  {
    name: "hold",
    description:
      "Deliberately wait for the next meaningful external signal, with a fallback timeout, when no productive state-change or query-state action is available this tick. Use when probes would stack up, an operator request has already been escalated, or downstream state is the only useful next signal. Counts as the tick's action.",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description:
            "Internal-only reason for the hold. Keep it precise and under 200 characters.",
        },
        nextTrigger: {
          type: "string",
          enum: [
            "operator_response",
            "hoglet_output",
            "pr_status_change",
            "timeout",
          ],
          description:
            "External signal that should release this hold and allow the next normal tick.",
        },
        timeoutSeconds: {
          type: "number",
          description:
            "Required when nextTrigger is timeout. Optional for event triggers as a shorter fallback timeout; use 300-600 seconds for hoglet_output when cloud communication is uncertain.",
        },
      },
      required: ["reason", "nextTrigger"],
    },
  },
  {
    name: "mark_validated",
    description:
      "Mark the nest validated when the definition of done is satisfied. Use this as the terminal success action instead of messaging hoglets to stand down; existing hoglet runs can finish naturally.",
    input_schema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description:
            "One- to three-sentence validation summary explaining why the nest goal is done.",
        },
        pr_urls: {
          type: "array",
          description: "Relevant PR URLs that support validation.",
          items: { type: "string" },
          maxItems: 25,
        },
        task_ids: {
          type: "array",
          description: "Hoglet task IDs whose work contributed to validation.",
          items: { type: "string" },
          maxItems: 50,
        },
        caveats: {
          type: "array",
          description:
            "Known caveats or follow-up notes that do not block validation.",
          items: { type: "string" },
          maxItems: 10,
        },
      },
      required: ["summary"],
    },
  },
  {
    name: "request_repository_access",
    description:
      "Request access to a GitHub repository not already in known_repositories. The dispatcher validates that the operator's GitHub integration can reach the repo. If confirmed, the repo becomes available for spawn_hoglet calls in this nest. Use when the goal requires a repo that wasn't part of the original nest configuration.",
    input_schema: {
      type: "object",
      properties: {
        repository: {
          type: "string",
          description:
            "Repository slug (e.g. 'org/repo') to request access to.",
        },
        reason: {
          type: "string",
          description:
            "Why this repo is needed for the nest's goal. Surfaced to the operator in the audit log.",
        },
      },
      required: ["repository", "reason"],
    },
  },
  {
    name: "link_pr_dependency",
    description:
      "Declare that one hoglet's PR is stacked on top of another's. Use when child_task's branch was branched off parent_task's branch, so a merged parent should trigger a rebase on the child. Idempotent — calling twice with the same pair is harmless.",
    input_schema: {
      type: "object",
      properties: {
        parent_task_id: {
          type: "string",
          description:
            "The task_id whose PR is the BASE of the stack (the one that will merge first).",
        },
        child_task_id: {
          type: "string",
          description:
            "The task_id whose PR depends on the parent (the one that will need a rebase).",
        },
        reason: {
          type: "string",
          description:
            "Why you're declaring this dependency; surfaced to the operator in the audit log.",
        },
      },
      required: ["parent_task_id", "child_task_id", "reason"],
    },
  },
  {
    name: "unlink_pr_dependency",
    description:
      "Remove a previously-declared PR dependency edge. Use when you decide the child no longer depends on the parent (e.g. you reassigned scope or the relationship was wrong).",
    input_schema: {
      type: "object",
      properties: {
        edge_id: {
          type: "string",
          description: "The id of the dependency edge to remove.",
        },
        reason: {
          type: "string",
          description: "Why the edge is being removed.",
        },
      },
      required: ["edge_id", "reason"],
    },
  },
  {
    name: "rebase_child",
    description:
      "Proactively route a 'rebase your branch' prompt to a child hoglet, without waiting for the parent-merge poll. Use when you can see the parent has merged (its `pr_state` is `merged`) but the poll hasn't fired yet, or when the operator asked you to push a rebase manually.",
    input_schema: {
      type: "object",
      properties: {
        edge_id: {
          type: "string",
          description:
            "The id of the PR dependency edge whose child should be rebased.",
        },
        prompt: {
          type: "string",
          description:
            "Optional custom prompt to deliver to the child. Defaults to a standard rebase instruction that names the parent branch.",
        },
      },
      required: ["edge_id"],
    },
  },
];

export type HedgehogToolName =
  | "spawn_hoglet"
  | "raise_hoglet"
  | "kill_hoglet"
  | "message_hoglet"
  | "write_audit_entry"
  | "hold"
  | "mark_validated"
  | "request_repository_access"
  | "link_pr_dependency"
  | "unlink_pr_dependency"
  | "rebase_child";

export const MAX_SPAWN_HOGLET_PROMPT_CHARS = HOGLET_PROMPT_MAX_CHARS;
export const MAX_SPAWN_HOGLET_TOOL_INPUT_CHARS = HOGLET_PROMPT_MAX_CHARS * 4;
export const MAX_MESSAGE_HOGLET_PROMPT_CHARS = 8000;
export const MAX_AUDIT_SUMMARY_CHARS = 2000;
export const MAX_AUDIT_DETAIL_CHARS = 8000;
export const MAX_VALIDATION_SUMMARY_CHARS = 8000;
export const MAX_HEDGEHOG_REASON_CHARS = 2000;
export const MAX_HOLD_REASON_CHARS = 200;
export const MAX_RAISE_PROMPT_CHARS = 2000;
export const MAX_REBASE_PROMPT_CHARS = 2000;

function textArg(max: number) {
  return z.preprocess((value) => {
    if (typeof value === "string" || value === undefined || value === null) {
      return value;
    }
    if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      typeof value === "bigint"
    ) {
      return String(value);
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, z.string().trim().min(1).max(max));
}

export const spawnHogletArgs = z.object({
  prompt: textArg(MAX_SPAWN_HOGLET_TOOL_INPUT_CHARS),
  repository: z.string().trim().min(1).optional(),
  /**
   * Optional reference to a signal report this spawn is following up on.
   * When set, the dispatcher cross-checks the operator's override memory and
   * refuses the spawn if the operator previously suppressed this report.
   */
  signal_report_id: z.string().trim().min(1).max(128).optional(),
});

export const raiseHogletArgs = z.object({
  hoglet_id: z.string().min(1),
  prompt: textArg(MAX_RAISE_PROMPT_CHARS).optional(),
});

export const killHogletArgs = z.object({
  hoglet_id: z.string().min(1),
  reason: textArg(MAX_HEDGEHOG_REASON_CHARS),
});

export const messageHogletArgs = z.object({
  hoglet_id: z.string().min(1),
  prompt: textArg(MAX_MESSAGE_HOGLET_PROMPT_CHARS),
});

export const writeAuditEntryArgs = z.object({
  summary: textArg(MAX_AUDIT_SUMMARY_CHARS),
  detail: textArg(MAX_AUDIT_DETAIL_CHARS).optional(),
});

export const holdArgs = z
  .object({
    reason: textArg(MAX_HOLD_REASON_CHARS),
    nextTrigger: holdNextTrigger,
    timeoutSeconds: z.number().int().positive().max(86_400).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.nextTrigger === "timeout" && value.timeoutSeconds === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["timeoutSeconds"],
        message: "timeoutSeconds is required when nextTrigger is timeout",
      });
    }
  });

export const markValidatedArgs = z.object({
  summary: textArg(MAX_VALIDATION_SUMMARY_CHARS),
  pr_urls: z.array(z.string().trim().min(1)).max(25).optional(),
  task_ids: z.array(z.string().trim().min(1)).max(50).optional(),
  caveats: z.array(z.string().trim().min(1)).max(10).optional(),
});

export const linkPrDependencyArgs = z.object({
  parent_task_id: z.string().min(1),
  child_task_id: z.string().min(1),
  reason: textArg(MAX_HEDGEHOG_REASON_CHARS),
});

export const unlinkPrDependencyArgs = z.object({
  edge_id: z.string().min(1),
  reason: textArg(MAX_HEDGEHOG_REASON_CHARS),
});

export const rebaseChildArgs = z.object({
  edge_id: z.string().min(1),
  prompt: textArg(MAX_REBASE_PROMPT_CHARS).optional(),
});

export const requestRepositoryAccessArgs = z.object({
  repository: z.string().trim().min(1),
  reason: textArg(MAX_HEDGEHOG_REASON_CHARS),
});

export type SpawnHogletArgs = z.infer<typeof spawnHogletArgs>;
export type RaiseHogletArgs = z.infer<typeof raiseHogletArgs>;
export type KillHogletArgs = z.infer<typeof killHogletArgs>;
export type MessageHogletArgs = z.infer<typeof messageHogletArgs>;
export type WriteAuditEntryArgs = z.infer<typeof writeAuditEntryArgs>;
export type HoldArgs = z.infer<typeof holdArgs>;
export type MarkValidatedArgs = z.infer<typeof markValidatedArgs>;
export type RequestRepositoryAccessArgs = z.infer<
  typeof requestRepositoryAccessArgs
>;
export type LinkPrDependencyArgs = z.infer<typeof linkPrDependencyArgs>;
export type UnlinkPrDependencyArgs = z.infer<typeof unlinkPrDependencyArgs>;
export type RebaseChildArgs = z.infer<typeof rebaseChildArgs>;

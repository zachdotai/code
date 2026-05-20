import type { TaskRunStatus } from "@shared/types";
import { messageHogletArgs } from "../hedgehog-tools";
import type { HandlerResult, HedgehogToolHandler } from "./types";
import { recordToolValidationError, truncate } from "./utils";

const ROUTABLE_RUN_STATUSES = new Set<TaskRunStatus>([
  "not_started",
  "queued",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
]);

export const messageHogletHandler: HedgehogToolHandler = {
  name: "message_hoglet",
  async handle(ctx, block, deps): Promise<HandlerResult> {
    const parsed = messageHogletArgs.safeParse(block.input);
    if (!parsed.success) {
      return recordToolValidationError(
        deps,
        ctx.nest.id,
        "message_hoglet",
        parsed.error.message,
      );
    }
    const args = parsed.data;
    const entry = ctx.hoglets.find((h) => h.hoglet.id === args.hoglet_id);
    if (!entry) {
      return recordToolValidationError(
        deps,
        ctx.nest.id,
        "message_hoglet",
        `hoglet ${args.hoglet_id} not in this nest`,
      );
    }

    await deps.feedbackRouting.routeHedgehogPrompt({
      taskId: entry.hoglet.taskId,
      hogletId: entry.hoglet.id,
      nestId: ctx.nest.id,
      prompt: args.prompt,
      toolCallId: block.id,
      latestRunId: entry.latestRunId,
      targetRunStatus: ROUTABLE_RUN_STATUSES.has(
        entry.taskRunStatus as TaskRunStatus,
      )
        ? (entry.taskRunStatus as TaskRunStatus)
        : null,
    });

    deps.writeNestMessage(ctx.nest.id, {
      kind: "audit",
      sourceTaskId: entry.hoglet.taskId,
      body: `Messaged hoglet ${args.hoglet_id}: ${truncate(args.prompt, 300)}`,
      payloadJson: {
        type: "message_hoglet_injected",
        hogletId: args.hoglet_id,
        prompt: args.prompt,
      },
    });
    return {
      success: true,
      scratchpadSummary: `message_hoglet routed for ${args.hoglet_id}`,
    };
  },
};

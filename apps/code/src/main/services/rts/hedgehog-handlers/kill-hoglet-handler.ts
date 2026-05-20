import { killHogletArgs } from "../hedgehog-tools";
import type { HandlerResult, HedgehogToolHandler } from "./types";
import { recordToolValidationError, stringifyError } from "./utils";

export const killHogletHandler: HedgehogToolHandler = {
  name: "kill_hoglet",
  async handle(ctx, block, deps): Promise<HandlerResult> {
    const parsed = killHogletArgs.safeParse(block.input);
    if (!parsed.success) {
      return recordToolValidationError(
        deps,
        ctx.nest.id,
        "kill_hoglet",
        parsed.error.message,
      );
    }
    const args = parsed.data;
    const entry = ctx.hoglets.find((h) => h.hoglet.id === args.hoglet_id);
    if (!entry) {
      return recordToolValidationError(
        deps,
        ctx.nest.id,
        "kill_hoglet",
        `hoglet ${args.hoglet_id} not in this nest`,
      );
    }
    const revived = ctx.operatorDecisions.find(
      (d) =>
        d.kind === "revive_hoglet" &&
        (d.subjectKey === args.hoglet_id ||
          d.subjectKey === entry.hoglet.taskId),
    );
    if (revived) {
      deps.writeNestMessage(ctx.nest.id, {
        kind: "audit",
        sourceTaskId: entry.hoglet.taskId,
        body: `Skipped kill_hoglet ${args.hoglet_id}: operator revived this hoglet.`,
        payloadJson: {
          type: "kill_suppressed_by_operator",
          hogletId: args.hoglet_id,
          taskId: entry.hoglet.taskId,
          reason: revived.reason,
          decisionId: revived.id,
        },
      });
      return {
        success: false,
        scratchpadSummary: `Operator revived hoglet ${revived.subjectKey}; skipping kill.`,
      };
    }
    if (
      entry.taskRunStatus === "completed" ||
      entry.taskRunStatus === "failed" ||
      entry.taskRunStatus === "cancelled" ||
      entry.taskRunStatus === "no_run"
    ) {
      deps.writeNestMessage(ctx.nest.id, {
        kind: "audit",
        body: `Skipped killing hoglet ${args.hoglet_id}: not currently active (${entry.taskRunStatus}).`,
        payloadJson: {
          type: "kill_skipped_inactive",
          hogletId: args.hoglet_id,
        },
      });
      return {
        success: false,
        scratchpadSummary: `kill_hoglet skipped (already ${entry.taskRunStatus})`,
      };
    }
    if (!entry.latestRunId) {
      deps.writeNestMessage(ctx.nest.id, {
        kind: "audit",
        body: `Cannot kill hoglet ${args.hoglet_id}: no latest_run_id resolved.`,
        payloadJson: {
          type: "kill_no_run_id",
          hogletId: args.hoglet_id,
        },
      });
      return {
        success: false,
        scratchpadSummary: "kill_hoglet missing latest_run_id",
      };
    }

    try {
      await deps.cloudTasks.updateTaskRun(
        entry.hoglet.taskId,
        entry.latestRunId,
        { status: "cancelled" },
      );
      deps.writeNestMessage(ctx.nest.id, {
        kind: "audit",
        sourceTaskId: entry.hoglet.taskId,
        body: `Killed hoglet ${args.hoglet_id}: ${args.reason}`,
        payloadJson: {
          type: "killed_hoglet",
          hogletId: args.hoglet_id,
          reason: args.reason,
        },
      });
      return {
        success: true,
        scratchpadSummary: `Killed hoglet ${args.hoglet_id}: ${args.reason}`,
      };
    } catch (error) {
      deps.writeNestMessage(ctx.nest.id, {
        kind: "audit",
        body: `Failed to kill hoglet ${args.hoglet_id}: ${stringifyError(error)}.`,
        payloadJson: {
          type: "kill_failed",
          hogletId: args.hoglet_id,
          error: stringifyError(error),
        },
      });
      return {
        success: false,
        scratchpadSummary: `kill_hoglet errored: ${stringifyError(error)}`,
      };
    }
  },
};

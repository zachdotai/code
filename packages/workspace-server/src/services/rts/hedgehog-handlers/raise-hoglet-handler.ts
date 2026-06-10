import { raiseHogletArgs } from "../hedgehog-tools";
import {
  readUserTaskPreferences,
  resolveHogletRuntime,
} from "../hoglet-runtime-preferences";
import type { HandlerResult, HedgehogToolHandler } from "./types";
import { recordToolValidationError, stringifyError, truncate } from "./utils";

export const MAX_RAISE_CALLS_PER_TICK = 3;

export const raiseHogletHandler: HedgehogToolHandler = {
  name: "raise_hoglet",
  async handle(ctx, block, deps): Promise<HandlerResult> {
    if (ctx.budget.raiseCount >= MAX_RAISE_CALLS_PER_TICK) {
      deps.writeNestMessage(ctx.nest.id, {
        kind: "audit",
        body: `Hedgehog tried to raise another hoglet but per-tick cap (${MAX_RAISE_CALLS_PER_TICK}) was reached.`,
        payloadJson: { type: "raise_capped", attempted: block.input },
      });
      return { success: false, scratchpadSummary: "raise_hoglet capped" };
    }
    ctx.budget.raiseCount += 1;

    const parsed = raiseHogletArgs.safeParse(block.input);
    if (!parsed.success) {
      return recordToolValidationError(
        deps,
        ctx.nest.id,
        "raise_hoglet",
        parsed.error.message,
      );
    }
    const args = parsed.data;
    const entry = ctx.hoglets.find((h) => h.hoglet.id === args.hoglet_id);
    if (!entry) {
      return recordToolValidationError(
        deps,
        ctx.nest.id,
        "raise_hoglet",
        `hoglet ${args.hoglet_id} not in this nest`,
      );
    }
    if (
      entry.taskRunStatus === "in_progress" ||
      entry.taskRunStatus === "queued"
    ) {
      deps.writeNestMessage(ctx.nest.id, {
        kind: "audit",
        body: `Skipped raising hoglet ${args.hoglet_id}: latest run is ${entry.taskRunStatus}.`,
        payloadJson: { type: "raise_skipped_active", hogletId: args.hoglet_id },
      });
      return {
        success: false,
        scratchpadSummary: `raise_hoglet skipped (${entry.taskRunStatus})`,
      };
    }

    const runtime = resolveHogletRuntime(
      ctx.loadout,
      readUserTaskPreferences(),
    );

    let createdRunId: string | null = null;
    try {
      const run = await deps.cloudTasks.createTaskRun(entry.hoglet.taskId, {
        environment: runtime.environment,
        mode: "background",
        runtimeAdapter: runtime.runtimeAdapter,
        model: runtime.model,
        reasoningEffort: runtime.reasoningEffort,
        initialPermissionMode: runtime.executionMode,
        prAuthorshipMode: "user",
      });
      createdRunId = run.id;
      await deps.hogletService.ensureCloudWorkspace(
        entry.hoglet.taskId,
        run.branch ?? null,
      );
      await deps.cloudTasks.startTaskRun(entry.hoglet.taskId, run.id, {
        pendingUserMessage: args.prompt,
      });
      deps.writeNestMessage(ctx.nest.id, {
        kind: "audit",
        sourceTaskId: entry.hoglet.taskId,
        body: `Raised hoglet ${args.hoglet_id}${args.prompt ? ` with prompt: ${truncate(args.prompt, 200)}` : ""}.`,
        payloadJson: {
          type: "raised_hoglet",
          hogletId: args.hoglet_id,
          taskId: entry.hoglet.taskId,
          taskRunId: run.id,
          prompt: args.prompt ?? null,
        },
      });
      return {
        success: true,
        scratchpadSummary: `Raised hoglet ${args.hoglet_id}`,
      };
    } catch (error) {
      if (createdRunId !== null) {
        // Roll back the cloud TaskRun we already created so it doesn't sit
        // orphaned in `not_started`. Spawn uses a Saga for the same effect;
        // raise is simple enough that an inline cleanup is clearer.
        try {
          await deps.cloudTasks.updateTaskRun(
            entry.hoglet.taskId,
            createdRunId,
            {
              status: "cancelled",
              errorMessage: "Cancelled after Rts raise failed",
            },
          );
        } catch (rollbackError) {
          deps.writeNestMessage(ctx.nest.id, {
            kind: "audit",
            body: `Failed to roll back orphaned task run ${createdRunId} on raise failure: ${stringifyError(rollbackError)}.`,
            payloadJson: {
              type: "raise_rollback_failed",
              hogletId: args.hoglet_id,
              taskId: entry.hoglet.taskId,
              taskRunId: createdRunId,
              error: stringifyError(rollbackError),
            },
          });
        }
      }
      deps.writeNestMessage(ctx.nest.id, {
        kind: "audit",
        body: `Failed to raise hoglet ${args.hoglet_id}: ${stringifyError(error)}.`,
        payloadJson: {
          type: "raise_failed",
          hogletId: args.hoglet_id,
          error: stringifyError(error),
          rolledBackTaskRunId: createdRunId,
        },
      });
      return {
        success: false,
        scratchpadSummary: `raise_hoglet errored: ${stringifyError(error)}`,
      };
    }
  },
};

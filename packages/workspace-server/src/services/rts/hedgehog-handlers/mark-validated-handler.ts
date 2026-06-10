import { markValidatedArgs } from "../hedgehog-tools";
import type { HandlerResult, HedgehogToolHandler } from "./types";
import { recordToolValidationError, stringifyError } from "./utils";

export const markValidatedHandler: HedgehogToolHandler = {
  name: "mark_validated",
  async handle(ctx, block, deps): Promise<HandlerResult> {
    const parsed = markValidatedArgs.safeParse(block.input);
    if (!parsed.success) {
      return recordToolValidationError(
        deps,
        ctx.nest.id,
        "mark_validated",
        parsed.error.message,
      );
    }

    const args = parsed.data;
    try {
      deps.nestService.markValidated({
        id: ctx.nest.id,
        summary: args.summary,
        prUrls: args.pr_urls,
        taskIds: args.task_ids,
        caveats: args.caveats,
      });
      return {
        success: true,
        scratchpadSummary: "Marked nest validated",
        stopDispatch: true,
      };
    } catch (error) {
      deps.writeNestMessage(ctx.nest.id, {
        kind: "audit",
        body: `Failed to mark nest validated: ${stringifyError(error)}`,
        payloadJson: {
          type: "mark_validated_failed",
          error: stringifyError(error),
        },
      });
      return {
        success: false,
        scratchpadSummary: `mark_validated failed: ${stringifyError(error)}`,
      };
    }
  },
};

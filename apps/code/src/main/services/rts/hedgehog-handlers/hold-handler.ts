import { holdArgs } from "../hedgehog-tools";
import type { HandlerResult, HedgehogToolHandler } from "./types";
import { recordToolValidationError, truncate } from "./utils";

export const holdHandler: HedgehogToolHandler = {
  name: "hold",
  async handle(ctx, block, deps): Promise<HandlerResult> {
    const parsed = holdArgs.safeParse(block.input);
    if (!parsed.success) {
      return recordToolValidationError(
        deps,
        ctx.nest.id,
        "hold",
        parsed.error.message,
      );
    }

    const args = parsed.data;
    deps.writeNestMessage(ctx.nest.id, {
      kind: "audit",
      body: `Hold until ${formatNextTrigger(args.nextTrigger)}: ${args.reason}`,
      visibility: "detail",
      payloadJson: {
        type: "hedgehog_hold",
        reason: args.reason,
        nextTrigger: args.nextTrigger,
        timeoutSeconds: args.timeoutSeconds ?? null,
      },
    });

    return {
      success: true,
      scratchpadSummary: `hold(${args.nextTrigger}): ${truncate(args.reason, 80)}`,
      stopDispatch: true,
      hold: args,
    };
  },
};

function formatNextTrigger(trigger: string): string {
  return trigger.replace(/_/g, " ");
}

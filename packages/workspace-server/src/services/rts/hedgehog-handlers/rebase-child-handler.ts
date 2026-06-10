import { rebaseChildArgs } from "../hedgehog-tools";
import type { HandlerResult, HedgehogToolHandler } from "./types";
import { recordToolValidationError, stringifyError } from "./utils";

export const rebaseChildHandler: HedgehogToolHandler = {
  name: "rebase_child",
  async handle(ctx, block, deps): Promise<HandlerResult> {
    const parsed = rebaseChildArgs.safeParse(block.input);
    if (!parsed.success) {
      return recordToolValidationError(
        deps,
        ctx.nest.id,
        "rebase_child",
        parsed.error.message,
      );
    }
    const args = parsed.data;
    const edge = ctx.prDependencies.find((e) => e.id === args.edge_id);
    if (!edge) {
      return recordToolValidationError(
        deps,
        ctx.nest.id,
        "rebase_child",
        `edge ${args.edge_id} not in this nest`,
      );
    }
    try {
      await deps.prGraph.requestRebase({
        edgeId: args.edge_id,
        promptOverride: args.prompt,
      });
      deps.writeNestMessage(ctx.nest.id, {
        kind: "audit",
        body: `Requested rebase for child ${edge.childTaskId} (parent ${edge.parentTaskId}).`,
        payloadJson: {
          type: "pr_graph_rebase_requested",
          edgeId: args.edge_id,
          parentTaskId: edge.parentTaskId,
          childTaskId: edge.childTaskId,
        },
      });
      return {
        success: true,
        scratchpadSummary: `Requested rebase for ${edge.childTaskId}`,
      };
    } catch (error) {
      deps.writeNestMessage(ctx.nest.id, {
        kind: "audit",
        body: `Failed to request rebase: ${stringifyError(error)}.`,
        payloadJson: {
          type: "pr_graph_rebase_request_failed",
          edgeId: args.edge_id,
          error: stringifyError(error),
        },
      });
      return {
        success: false,
        scratchpadSummary: `rebase_child errored: ${stringifyError(error)}`,
      };
    }
  },
};

import { unlinkPrDependencyArgs } from "../hedgehog-tools";
import type { HandlerResult, HedgehogToolHandler } from "./types";
import { recordToolValidationError, stringifyError } from "./utils";

export const unlinkPrDependencyHandler: HedgehogToolHandler = {
  name: "unlink_pr_dependency",
  async handle(ctx, block, deps): Promise<HandlerResult> {
    const parsed = unlinkPrDependencyArgs.safeParse(block.input);
    if (!parsed.success) {
      return recordToolValidationError(
        deps,
        ctx.nest.id,
        "unlink_pr_dependency",
        parsed.error.message,
      );
    }
    const args = parsed.data;
    const edge = ctx.prDependencies.find((e) => e.id === args.edge_id);
    if (!edge) {
      return recordToolValidationError(
        deps,
        ctx.nest.id,
        "unlink_pr_dependency",
        `edge ${args.edge_id} not in this nest`,
      );
    }
    try {
      deps.prGraph.unlink({ id: args.edge_id });
      deps.writeNestMessage(ctx.nest.id, {
        kind: "audit",
        body: `Unlinked PR dependency ${args.edge_id}. ${args.reason}`,
        payloadJson: {
          type: "pr_graph_unlinked",
          edgeId: args.edge_id,
          reason: args.reason,
        },
      });
      return {
        success: true,
        scratchpadSummary: `Unlinked edge ${args.edge_id}`,
      };
    } catch (error) {
      deps.writeNestMessage(ctx.nest.id, {
        kind: "audit",
        body: `Failed to unlink PR dependency: ${stringifyError(error)}.`,
        payloadJson: {
          type: "pr_graph_unlink_failed",
          edgeId: args.edge_id,
          error: stringifyError(error),
        },
      });
      return {
        success: false,
        scratchpadSummary: `unlink_pr_dependency errored: ${stringifyError(error)}`,
      };
    }
  },
};

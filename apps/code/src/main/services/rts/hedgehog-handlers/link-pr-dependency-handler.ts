import { linkPrDependencyArgs } from "../hedgehog-tools";
import type { HandlerResult, HedgehogToolHandler } from "./types";
import { recordToolValidationError, stringifyError } from "./utils";

export const linkPrDependencyHandler: HedgehogToolHandler = {
  name: "link_pr_dependency",
  async handle(ctx, block, deps): Promise<HandlerResult> {
    const parsed = linkPrDependencyArgs.safeParse(block.input);
    if (!parsed.success) {
      return recordToolValidationError(
        deps,
        ctx.nest.id,
        "link_pr_dependency",
        parsed.error.message,
      );
    }
    const args = parsed.data;
    if (args.parent_task_id === args.child_task_id) {
      return recordToolValidationError(
        deps,
        ctx.nest.id,
        "link_pr_dependency",
        "parent_task_id and child_task_id must differ",
      );
    }
    const parent = ctx.hoglets.find(
      (h) => h.hoglet.taskId === args.parent_task_id,
    );
    const child = ctx.hoglets.find(
      (h) => h.hoglet.taskId === args.child_task_id,
    );
    if (!parent || !child) {
      return recordToolValidationError(
        deps,
        ctx.nest.id,
        "link_pr_dependency",
        `both task_ids must belong to nest ${ctx.nest.id}`,
      );
    }
    try {
      const edge = deps.prGraph.link({
        nestId: ctx.nest.id,
        parentTaskId: args.parent_task_id,
        childTaskId: args.child_task_id,
      });
      deps.writeNestMessage(ctx.nest.id, {
        kind: "audit",
        body: `Linked PR dependency: ${args.parent_task_id} → ${args.child_task_id}. ${args.reason}`,
        payloadJson: {
          type: "pr_graph_linked",
          edgeId: edge.id,
          parentTaskId: args.parent_task_id,
          childTaskId: args.child_task_id,
          reason: args.reason,
        },
      });
      return {
        success: true,
        scratchpadSummary: `Linked ${args.parent_task_id} → ${args.child_task_id}`,
      };
    } catch (error) {
      deps.writeNestMessage(ctx.nest.id, {
        kind: "audit",
        body: `Failed to link PR dependency: ${stringifyError(error)}.`,
        payloadJson: {
          type: "pr_graph_link_failed",
          parentTaskId: args.parent_task_id,
          childTaskId: args.child_task_id,
          error: stringifyError(error),
        },
      });
      return {
        success: false,
        scratchpadSummary: `link_pr_dependency errored: ${stringifyError(error)}`,
      };
    }
  },
};

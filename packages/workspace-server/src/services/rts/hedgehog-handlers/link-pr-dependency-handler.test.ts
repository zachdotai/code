import { describe, expect, it } from "vitest";
import { linkPrDependencyHandler } from "./link-pr-dependency-handler";
import {
  makeContext,
  makeHoglet,
  makeHogletWithState,
  makeMockDeps,
  makePrDependency,
  makeToolBlock,
} from "./test-helpers";

function hogletWithTask(taskId: string) {
  return makeHogletWithState({
    hoglet: makeHoglet({ id: `hoglet-${taskId}`, taskId }),
  });
}

describe("linkPrDependencyHandler", () => {
  it("links the edge and writes a pr_graph_linked audit", async () => {
    const { deps, prGraph, writeNestMessage } = makeMockDeps();
    prGraph.link.mockReturnValue(makePrDependency({ id: "edge-new" }));

    const result = await linkPrDependencyHandler.handle(
      makeContext({
        hoglets: [hogletWithTask("task-parent"), hogletWithTask("task-child")],
      }),
      makeToolBlock("link_pr_dependency", {
        parent_task_id: "task-parent",
        child_task_id: "task-child",
        reason: "child is stacked on parent",
      }),
      deps,
    );

    expect(result.success).toBe(true);
    expect(prGraph.link).toHaveBeenCalledWith({
      nestId: "nest-1",
      parentTaskId: "task-parent",
      childTaskId: "task-child",
    });
    expect(writeNestMessage).toHaveBeenCalledWith(
      "nest-1",
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          type: "pr_graph_linked",
          edgeId: "edge-new",
          parentTaskId: "task-parent",
          childTaskId: "task-child",
        }),
      }),
    );
  });

  it("rejects when parent and child are the same task", async () => {
    const { deps, prGraph } = makeMockDeps();

    const result = await linkPrDependencyHandler.handle(
      makeContext({ hoglets: [hogletWithTask("task-same")] }),
      makeToolBlock("link_pr_dependency", {
        parent_task_id: "task-same",
        child_task_id: "task-same",
        reason: "oops",
      }),
      deps,
    );

    expect(result.success).toBe(false);
    expect(result.scratchpadSummary).toContain("validation failed");
    expect(prGraph.link).not.toHaveBeenCalled();
  });

  it("rejects when one of the tasks is not in this nest", async () => {
    const { deps, prGraph } = makeMockDeps();

    const result = await linkPrDependencyHandler.handle(
      makeContext({ hoglets: [hogletWithTask("task-parent")] }),
      makeToolBlock("link_pr_dependency", {
        parent_task_id: "task-parent",
        child_task_id: "task-other",
        reason: "stacked",
      }),
      deps,
    );

    expect(result.success).toBe(false);
    expect(prGraph.link).not.toHaveBeenCalled();
  });

  it("captures pr-graph errors as a pr_graph_link_failed audit", async () => {
    const { deps, prGraph, writeNestMessage } = makeMockDeps();
    prGraph.link.mockImplementation(() => {
      throw new Error("unique constraint");
    });

    const result = await linkPrDependencyHandler.handle(
      makeContext({
        hoglets: [hogletWithTask("task-parent"), hogletWithTask("task-child")],
      }),
      makeToolBlock("link_pr_dependency", {
        parent_task_id: "task-parent",
        child_task_id: "task-child",
        reason: "stacked",
      }),
      deps,
    );

    expect(result.success).toBe(false);
    expect(result.scratchpadSummary).toContain("link_pr_dependency errored");
    expect(writeNestMessage).toHaveBeenCalledWith(
      "nest-1",
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          type: "pr_graph_link_failed",
          parentTaskId: "task-parent",
          childTaskId: "task-child",
        }),
      }),
    );
  });
});

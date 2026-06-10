import { describe, expect, it } from "vitest";
import { rebaseChildHandler } from "./rebase-child-handler";
import {
  makeContext,
  makeMockDeps,
  makePrDependency,
  makeToolBlock,
} from "./test-helpers";

describe("rebaseChildHandler", () => {
  it("requests a rebase via pr-graph and writes a pr_graph_rebase_requested audit", async () => {
    const edge = makePrDependency({
      id: "edge-1",
      parentTaskId: "task-parent",
      childTaskId: "task-child",
    });
    const { deps, prGraph, writeNestMessage } = makeMockDeps();
    prGraph.requestRebase.mockResolvedValue(undefined);

    const result = await rebaseChildHandler.handle(
      makeContext({ prDependencies: [edge] }),
      makeToolBlock("rebase_child", {
        edge_id: "edge-1",
        prompt: "rebase onto main",
      }),
      deps,
    );

    expect(result.success).toBe(true);
    expect(prGraph.requestRebase).toHaveBeenCalledWith({
      edgeId: "edge-1",
      promptOverride: "rebase onto main",
    });
    expect(writeNestMessage).toHaveBeenCalledWith(
      "nest-1",
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          type: "pr_graph_rebase_requested",
          edgeId: "edge-1",
          parentTaskId: "task-parent",
          childTaskId: "task-child",
        }),
      }),
    );
  });

  it("rejects an edge that is not part of this nest", async () => {
    const { deps, prGraph } = makeMockDeps();

    const result = await rebaseChildHandler.handle(
      makeContext({ prDependencies: [] }),
      makeToolBlock("rebase_child", { edge_id: "edge-missing" }),
      deps,
    );

    expect(result.success).toBe(false);
    expect(result.scratchpadSummary).toContain("validation failed");
    expect(prGraph.requestRebase).not.toHaveBeenCalled();
  });

  it("records pr_graph_rebase_request_failed when pr-graph rejects", async () => {
    const edge = makePrDependency({ id: "edge-err" });
    const { deps, prGraph, writeNestMessage } = makeMockDeps();
    prGraph.requestRebase.mockRejectedValue(new Error("not ready"));

    const result = await rebaseChildHandler.handle(
      makeContext({ prDependencies: [edge] }),
      makeToolBlock("rebase_child", { edge_id: "edge-err" }),
      deps,
    );

    expect(result.success).toBe(false);
    expect(writeNestMessage).toHaveBeenCalledWith(
      "nest-1",
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          type: "pr_graph_rebase_request_failed",
          edgeId: "edge-err",
        }),
      }),
    );
  });
});

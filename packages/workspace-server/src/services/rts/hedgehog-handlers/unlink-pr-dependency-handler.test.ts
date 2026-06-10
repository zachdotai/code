import { describe, expect, it } from "vitest";
import {
  makeContext,
  makeMockDeps,
  makePrDependency,
  makeToolBlock,
} from "./test-helpers";
import { unlinkPrDependencyHandler } from "./unlink-pr-dependency-handler";

describe("unlinkPrDependencyHandler", () => {
  it("unlinks an edge that exists in this nest", async () => {
    const edge = makePrDependency({ id: "edge-xyz" });
    const { deps, prGraph, writeNestMessage } = makeMockDeps();

    const result = await unlinkPrDependencyHandler.handle(
      makeContext({ prDependencies: [edge] }),
      makeToolBlock("unlink_pr_dependency", {
        edge_id: "edge-xyz",
        reason: "no longer stacked",
      }),
      deps,
    );

    expect(result.success).toBe(true);
    expect(prGraph.unlink).toHaveBeenCalledWith({ id: "edge-xyz" });
    expect(writeNestMessage).toHaveBeenCalledWith(
      "nest-1",
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          type: "pr_graph_unlinked",
          edgeId: "edge-xyz",
        }),
      }),
    );
  });

  it("rejects when the edge is not in this nest's prDependencies", async () => {
    const { deps, prGraph } = makeMockDeps();

    const result = await unlinkPrDependencyHandler.handle(
      makeContext({ prDependencies: [] }),
      makeToolBlock("unlink_pr_dependency", {
        edge_id: "edge-missing",
        reason: "n/a",
      }),
      deps,
    );

    expect(result.success).toBe(false);
    expect(result.scratchpadSummary).toContain("validation failed");
    expect(prGraph.unlink).not.toHaveBeenCalled();
  });

  it("records pr_graph_unlink_failed when pr-graph throws", async () => {
    const edge = makePrDependency({ id: "edge-bad" });
    const { deps, prGraph, writeNestMessage } = makeMockDeps();
    prGraph.unlink.mockImplementation(() => {
      throw new Error("edge gone");
    });

    const result = await unlinkPrDependencyHandler.handle(
      makeContext({ prDependencies: [edge] }),
      makeToolBlock("unlink_pr_dependency", {
        edge_id: "edge-bad",
        reason: "stale",
      }),
      deps,
    );

    expect(result.success).toBe(false);
    expect(writeNestMessage).toHaveBeenCalledWith(
      "nest-1",
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          type: "pr_graph_unlink_failed",
          edgeId: "edge-bad",
        }),
      }),
    );
  });
});

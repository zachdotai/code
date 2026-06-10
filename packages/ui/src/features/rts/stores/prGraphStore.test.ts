import type { PrDependencyView } from "@posthog/host-router/rts-schemas";
import { beforeEach, describe, expect, it } from "vitest";
import {
  selectEdgesForNest,
  selectEdgesLoadedForNest,
  usePrGraphStore,
} from "./prGraphStore";

function makeEdge(overrides: Partial<PrDependencyView> = {}): PrDependencyView {
  const now = "2026-05-14T00:00:00.000Z";
  return {
    id: "edge-1",
    nestId: "nest-1",
    parentTaskId: "parent",
    childTaskId: "child",
    state: "pending",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("prGraphStore", () => {
  beforeEach(() => {
    usePrGraphStore.getState().reset();
  });

  it("sets edges for a nest and marks it loaded", () => {
    const edge = makeEdge();

    usePrGraphStore.getState().setForNest("nest-1", [edge]);

    expect(selectEdgesForNest("nest-1")(usePrGraphStore.getState())).toEqual([
      edge,
    ]);
    expect(selectEdgesLoadedForNest("nest-1")(usePrGraphStore.getState())).toBe(
      true,
    );
  });

  it("upserts and removes edges", () => {
    const edge = makeEdge();
    const updated = makeEdge({ state: "satisfied" });

    usePrGraphStore.getState().upsert("nest-1", edge);
    usePrGraphStore.getState().upsert("nest-1", updated);

    expect(selectEdgesForNest("nest-1")(usePrGraphStore.getState())).toEqual([
      updated,
    ]);

    usePrGraphStore.getState().remove("nest-1", edge.id);
    expect(selectEdgesForNest("nest-1")(usePrGraphStore.getState())).toEqual(
      [],
    );
  });
});

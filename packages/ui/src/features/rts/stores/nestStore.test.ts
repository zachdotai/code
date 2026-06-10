import type { HedgehogStateView, Nest } from "@posthog/host-router/rts-schemas";
import { beforeEach, describe, expect, it } from "vitest";
import { selectHedgehogState, selectNests, useNestStore } from "./nestStore";

function makeNest(overrides: Partial<Nest> = {}): Nest {
  const now = "2026-05-14T00:00:00.000Z";
  return {
    id: "nest-1",
    name: "Nest",
    goalPrompt: "Goal",
    definitionOfDone: null,
    mapX: 0,
    mapY: 0,
    status: "active",
    health: "ok",
    primaryRepository: null,
    targetMetricId: null,
    loadoutJson: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("nestStore", () => {
  beforeEach(() => {
    useNestStore.setState({
      nests: {},
      hedgehogStateByNestId: {},
      loaded: false,
    });
  });

  it("sets and filters nests", () => {
    const active = makeNest({ id: "active", status: "active" });
    const archived = makeNest({ id: "archived", status: "archived" });

    useNestStore.getState().setAll([active, archived]);

    expect(useNestStore.getState().loaded).toBe(true);
    expect(selectNests(useNestStore.getState())).toEqual([active]);
  });

  it("removes nest state and matching hedgehog state", () => {
    const nest = makeNest({ id: "nest-1" });
    const hedgehogState: HedgehogStateView = {
      state: "ticking",
      lastTickAt: "2026-05-14T00:01:00.000Z",
    };

    useNestStore.getState().upsert(nest);
    useNestStore.getState().setHedgehogState(nest.id, hedgehogState);
    expect(selectHedgehogState(nest.id)(useNestStore.getState())).toEqual(
      hedgehogState,
    );

    useNestStore.getState().remove(nest.id);

    expect(selectNests(useNestStore.getState())).toEqual([]);
    expect(selectHedgehogState(nest.id)(useNestStore.getState())).toBeNull();
  });
});

import type { Nest } from "@main/services/rts/schemas";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHogletPositionStore } from "../stores/hogletPositionStore";
import { useHogletStore } from "../stores/hogletStore";
import { useNestStore } from "../stores/nestStore";
import { HOGLET_RADIUS, NEST_OBSTACLE_RADIUS } from "../utils/worldObstacles";
import { useTransitPath } from "./useTransitPath";

vi.mock("@renderer/trpc/client", () => ({
  trpcClient: {
    secureStore: {
      getItem: { query: vi.fn().mockResolvedValue(null) },
      setItem: { query: vi.fn().mockResolvedValue(undefined) },
      removeItem: { query: vi.fn().mockResolvedValue(undefined) },
    },
  },
}));

function makeNest(overrides: Partial<Nest> & { id: string }): Nest {
  return {
    id: overrides.id,
    name: overrides.name ?? `nest-${overrides.id}`,
    goalPrompt: "",
    definitionOfDone: null,
    mapX: overrides.mapX ?? 0,
    mapY: overrides.mapY ?? 0,
    status: overrides.status ?? "active",
    health: overrides.health ?? "ok",
    targetMetricId: null,
    loadoutJson: null,
    primaryRepository: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

describe("useTransitPath", () => {
  beforeEach(() => {
    useNestStore.setState({
      nests: {},
      hedgehogStateByNestId: {},
      loaded: false,
    });
    useHogletStore.getState().reset();
    useHogletPositionStore.getState().reset();
  });

  it("returns undefined on first mount", () => {
    const { result } = renderHook(() => useTransitPath(100, 100, 24, true));
    expect(result.current).toBeUndefined();
  });

  it("returns undefined when disabled even after the target changes", () => {
    const { result, rerender } = renderHook(
      ({ x, y }: { x: number; y: number }) => useTransitPath(x, y, 24, false),
      { initialProps: { x: 100, y: 100 } },
    );
    act(() => rerender({ x: 400, y: 400 }));
    expect(result.current).toBeUndefined();
  });

  it("returns undefined when the target hasn't moved", () => {
    const { result, rerender } = renderHook(
      ({ x, y }: { x: number; y: number }) =>
        useTransitPath(x, y, HOGLET_RADIUS, true),
      { initialProps: { x: 50, y: 50 } },
    );
    act(() => rerender({ x: 50, y: 50 }));
    expect(result.current).toBeUndefined();
  });

  it("routes around a nest blocking the straight line between two ring slots", () => {
    // Hedgehouse sits at origin (always in the obstacle list). Place an extra
    // nest off to the side and request a walk on a line that crosses it.
    useNestStore.setState({
      nests: {
        n1: makeNest({ id: "n1", mapX: 400, mapY: 0 }),
      },
      hedgehogStateByNestId: {},
      loaded: true,
    });

    const { result, rerender } = renderHook(
      ({ x, y }: { x: number; y: number }) =>
        useTransitPath(x, y, HOGLET_RADIUS, true),
      // Far side of the offset nest.
      { initialProps: { x: 600, y: 0 } },
    );
    // First render captures the prior target, no path yet.
    expect(result.current).toBeUndefined();

    // Walk to the opposite side, crossing the nest at (400, 0).
    act(() => rerender({ x: 200, y: 0 }));
    const path = result.current;
    expect(path).toBeDefined();
    if (!path) throw new Error("expected path");
    // Detour must add at least one intermediate waypoint.
    expect(path.length).toBeGreaterThanOrEqual(3);
    // Every waypoint must sit outside the inflated nest radius.
    const inflated = NEST_OBSTACLE_RADIUS + HOGLET_RADIUS;
    for (const p of path) {
      const dx = p.x - 400;
      const dy = p.y - 0;
      expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(inflated - 1);
    }
  });
});

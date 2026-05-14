import type { Nest } from "@main/services/hedgemony/schemas";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBuilderCoordinator } from "./useBuilderCoordinator";

function makeNest(overrides: Partial<Nest> = {}): Nest {
  return {
    id: "nest-1",
    name: "Test nest",
    goalPrompt: "Do a thing",
    definitionOfDone: null,
    mapX: 0,
    mapY: 0,
    status: "active",
    health: "ok",
    targetMetricId: null,
    loadoutJson: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("useBuilderCoordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("starts idle at the initial position", () => {
    const { result } = renderHook(() =>
      useBuilderCoordinator({ nests: [], initialPos: { x: 10, y: 20 } }),
    );
    expect(result.current.animation).toBe("idle");
    expect(result.current.pos).toEqual({ x: 10, y: 20 });
    expect(result.current.path).toEqual([{ x: 10, y: 20 }]);
  });

  it("transitions idle -> walking on startWalk to a reachable target", () => {
    const { result } = renderHook(() => useBuilderCoordinator({ nests: [] }));
    act(() => {
      result.current.startWalk({ x: 500, y: 0 }, "idle");
    });
    expect(result.current.animation).toBe("walking");
    expect(result.current.path.length).toBeGreaterThanOrEqual(2);
  });

  it("transitions walking -> idle on handleArrive when onArrive is idle", () => {
    const { result } = renderHook(() => useBuilderCoordinator({ nests: [] }));
    act(() => {
      result.current.startWalk({ x: 200, y: 0 }, "idle");
    });
    act(() => {
      result.current.handleArrive();
    });
    expect(result.current.animation).toBe("idle");
  });

  it("transitions walking -> building -> idle when onArrive is build", () => {
    const { result } = renderHook(() =>
      useBuilderCoordinator({ nests: [], buildAnimationMs: 1500 }),
    );
    act(() => {
      result.current.startWalk({ x: 200, y: 0 }, "build");
    });
    expect(result.current.animation).toBe("walking");
    act(() => {
      result.current.handleArrive();
    });
    expect(result.current.animation).toBe("building");
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(result.current.animation).toBe("idle");
  });

  it("a new startWalk during building cancels the build timer", () => {
    const { result } = renderHook(() =>
      useBuilderCoordinator({ nests: [], buildAnimationMs: 1500 }),
    );
    act(() => {
      result.current.startWalk({ x: 100, y: 0 }, "build");
    });
    act(() => {
      result.current.handleArrive();
    });
    expect(result.current.animation).toBe("building");
    act(() => {
      // Interrupt mid-building.
      result.current.startWalk({ x: 300, y: 0 }, "idle");
    });
    expect(result.current.animation).toBe("walking");
    // Advancing past the original build timer should NOT trip us back to
    // idle out of nowhere — we're now walking and stay walking.
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(result.current.animation).toBe("walking");
  });

  it("startWalk with a zero-distance target into build immediately enters building", () => {
    const { result } = renderHook(() =>
      useBuilderCoordinator({ nests: [], initialPos: { x: 0, y: 0 } }),
    );
    act(() => {
      result.current.startWalk({ x: 0, y: 0 }, "build");
    });
    expect(result.current.animation).toBe("building");
  });

  it("startWalk with a zero-distance target into idle stays idle", () => {
    const { result } = renderHook(() =>
      useBuilderCoordinator({ nests: [], initialPos: { x: 0, y: 0 } }),
    );
    act(() => {
      result.current.startWalk({ x: 0, y: 0 }, "idle");
    });
    expect(result.current.animation).toBe("idle");
  });

  it("handleSegmentComplete advances pos to the reached waypoint", () => {
    const { result } = renderHook(() =>
      useBuilderCoordinator({ nests: [], initialPos: { x: 0, y: 0 } }),
    );
    act(() => {
      result.current.startWalk({ x: 400, y: 0 }, "idle");
    });
    const path = result.current.path;
    expect(path.length).toBeGreaterThanOrEqual(2);
    act(() => {
      result.current.handleSegmentComplete(1);
    });
    expect(result.current.pos).toEqual(path[1]);
  });

  it("paths around a nest obstacle that sits on the straight line", () => {
    const nest = makeNest({ id: "n1", mapX: 200, mapY: 0 });
    const { result } = renderHook(() =>
      useBuilderCoordinator({ nests: [nest], initialPos: { x: 0, y: 0 } }),
    );
    act(() => {
      result.current.startWalk({ x: 400, y: 0 }, "idle");
    });
    // Direct line passes through the obstacle, so the planner must add at
    // least one intermediate waypoint.
    expect(result.current.path.length).toBeGreaterThanOrEqual(3);
  });

  it("never plans a path that crosses the Hedgehouse from the default spawn", () => {
    // Regression: the prior (0, 130) default sat inside the inflated
    // Hedgehouse (raw radius 100 + builder radius 36 = 136), so findPath's
    // escape-from-inside logic walked the builder straight through the
    // building on any walk to the north side. The default must stay clear
    // of the inflated obstacle so that no segment of any plan crosses the
    // painted Hedgehouse footprint (raw radius 100).
    const { result } = renderHook(() => useBuilderCoordinator({ nests: [] }));
    act(() => {
      result.current.startWalk({ x: 0, y: -300 }, "idle");
    });
    const path = result.current.path;
    expect(path.length).toBeGreaterThanOrEqual(2);
    // Every waypoint stays outside the painted Hedgehouse.
    for (const p of path) {
      expect(Math.hypot(p.x, p.y)).toBeGreaterThanOrEqual(99);
    }
    // Every segment midpoint stays outside too — catches the case where
    // adjacent waypoints straddle the obstacle.
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      for (let t = 0; t <= 1; t += 0.05) {
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        expect(Math.hypot(x, y)).toBeGreaterThanOrEqual(99);
      }
    }
  });

  it("handleArrive is a no-op when not walking", () => {
    const { result } = renderHook(() => useBuilderCoordinator({ nests: [] }));
    act(() => {
      result.current.handleArrive();
    });
    expect(result.current.animation).toBe("idle");
  });

  describe("deferred build (onPendingBuildCommit)", () => {
    it("commits the pending nest after the build animation completes", () => {
      const commit = vi.fn();
      const nest = makeNest({ id: "pending-1", mapX: 200, mapY: 0 });
      const { result } = renderHook(() =>
        useBuilderCoordinator({
          nests: [],
          buildAnimationMs: 1500,
          onPendingBuildCommit: commit,
        }),
      );
      act(() => {
        result.current.startWalk({ x: 200, y: 0 }, "build", nest);
      });
      act(() => {
        result.current.handleArrive();
      });
      expect(commit).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(commit).toHaveBeenCalledTimes(1);
      expect(commit).toHaveBeenCalledWith(nest);
    });

    it("commits the pending nest if a non-build walk interrupts mid-flight", () => {
      const commit = vi.fn();
      const nest = makeNest({ id: "pending-2", mapX: 200, mapY: 0 });
      const { result } = renderHook(() =>
        useBuilderCoordinator({
          nests: [],
          onPendingBuildCommit: commit,
        }),
      );
      act(() => {
        result.current.startWalk({ x: 200, y: 0 }, "build", nest);
      });
      act(() => {
        // Interrupt with a plain move.
        result.current.startWalk({ x: 50, y: 0 }, "idle");
      });
      expect(commit).toHaveBeenCalledTimes(1);
      expect(commit).toHaveBeenCalledWith(nest);
    });

    it("does not double-commit when handleArrive then timer both fire", () => {
      const commit = vi.fn();
      const nest = makeNest({ id: "pending-3", mapX: 200, mapY: 0 });
      const { result } = renderHook(() =>
        useBuilderCoordinator({
          nests: [],
          buildAnimationMs: 1500,
          onPendingBuildCommit: commit,
        }),
      );
      act(() => {
        result.current.startWalk({ x: 200, y: 0 }, "build", nest);
      });
      act(() => {
        result.current.handleArrive();
      });
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(commit).toHaveBeenCalledTimes(1);
    });

    it("queueing a second pending build commits the first one immediately", () => {
      const commit = vi.fn();
      const first = makeNest({ id: "first", mapX: 100, mapY: 0 });
      const second = makeNest({ id: "second", mapX: 300, mapY: 0 });
      const { result } = renderHook(() =>
        useBuilderCoordinator({
          nests: [],
          onPendingBuildCommit: commit,
        }),
      );
      act(() => {
        result.current.startWalk({ x: 100, y: 0 }, "build", first);
      });
      act(() => {
        result.current.startWalk({ x: 300, y: 0 }, "build", second);
      });
      expect(commit).toHaveBeenCalledTimes(1);
      expect(commit).toHaveBeenCalledWith(first);
    });

    it("does not commit when no pending build is queued", () => {
      const commit = vi.fn();
      const { result } = renderHook(() =>
        useBuilderCoordinator({
          nests: [],
          buildAnimationMs: 1500,
          onPendingBuildCommit: commit,
        }),
      );
      act(() => {
        result.current.startWalk({ x: 200, y: 0 }, "build");
      });
      act(() => {
        result.current.handleArrive();
      });
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(commit).not.toHaveBeenCalled();
    });
  });
});

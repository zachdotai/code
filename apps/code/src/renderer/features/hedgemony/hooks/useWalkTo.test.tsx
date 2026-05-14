import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock framer-motion's `animate` so the test deterministically controls
// when each segment "completes" via the onComplete callback. We capture
// every animate() call so we can fire its onComplete synchronously and
// inspect the final motion values.
const animateCalls: Array<{
  target: number;
  onComplete?: () => void;
  motion: { set: (v: number) => void; get: () => number };
}> = [];

vi.mock("framer-motion", async () => {
  const actual =
    await vi.importActual<typeof import("framer-motion")>("framer-motion");
  return {
    ...actual,
    animate: (
      motion: { set: (v: number) => void; get: () => number },
      target: number,
      opts: { onComplete?: () => void } = {},
    ) => {
      animateCalls.push({ target, onComplete: opts.onComplete, motion });
      // The real animate would run an interpolation over `duration` — for
      // the test we resolve instantly to the target value when the segment
      // is "completed" by the caller.
      return { stop: () => undefined };
    },
  };
});

import { useWalkTo } from "./useWalkTo";

describe("useWalkTo", () => {
  beforeEach(() => {
    animateCalls.length = 0;
  });
  afterEach(() => {
    animateCalls.length = 0;
  });

  function completeAll() {
    // Each segment fires animate() twice (x + y). Only the y call carries
    // onComplete (matching the production hook). Fire them in order.
    while (animateCalls.length > 0) {
      const call = animateCalls.shift();
      if (!call) break;
      call.motion.set(call.target);
      call.onComplete?.();
    }
  }

  it("walks straight to the target when no transitPath is given", () => {
    const { rerender, result } = renderHook(
      ({ x, y }: { x: number; y: number }) => useWalkTo(x, y),
      { initialProps: { x: 0, y: 0 } },
    );

    expect(result.current.motionX.get()).toBe(0);
    expect(result.current.motionY.get()).toBe(0);

    act(() => {
      rerender({ x: 100, y: 0 });
    });
    expect(animateCalls.length).toBeGreaterThan(0);
    act(() => {
      completeAll();
    });
    expect(result.current.motionX.get()).toBe(100);
    expect(result.current.motionY.get()).toBe(0);
  });

  it("walks every waypoint in the transit path before landing on the target", () => {
    const { rerender, result } = renderHook(
      ({
        x,
        y,
        path,
      }: {
        x: number;
        y: number;
        path?: { x: number; y: number }[];
      }) => useWalkTo(x, y, path),
      {
        initialProps: { x: 0, y: 0, path: undefined } as {
          x: number;
          y: number;
          path?: { x: number; y: number }[];
        },
      },
    );

    expect(result.current.motionX.get()).toBe(0);

    // path mirrors what findPath produces: [from, ...waypoints, to].
    act(() => {
      rerender({
        x: 300,
        y: 0,
        path: [
          { x: 0, y: 0 },
          { x: 100, y: 80 },
          { x: 200, y: 80 },
          { x: 300, y: 0 },
        ],
      });
    });

    // First segment from (0,0) → (100, 80) — animate fires for x AND y.
    expect(animateCalls.length).toBe(2);
    const visited: { x: number; y: number }[] = [];
    // Drain segments one at a time so we can record motion values per stop.
    while (animateCalls.length > 0) {
      const xCall = animateCalls.shift();
      const yCall = animateCalls.shift();
      if (!xCall || !yCall) break;
      act(() => {
        xCall.motion.set(xCall.target);
        yCall.motion.set(yCall.target);
        yCall.onComplete?.();
      });
      visited.push({
        x: result.current.motionX.get(),
        y: result.current.motionY.get(),
      });
    }

    expect(visited).toEqual([
      { x: 100, y: 80 },
      { x: 200, y: 80 },
      { x: 300, y: 0 },
    ]);
  });
});

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HEDGEMONY_CONFIG } from "../config";

vi.mock("../runtime/SceneTicker", async () => {
  const mod = await vi.importActual<
    typeof import("../runtime/FakeSceneTicker")
  >("../runtime/FakeSceneTicker");
  return { sceneTicker: new mod.FakeSceneTicker() };
});

import type { FakeSceneTicker } from "../runtime/FakeSceneTicker";
import { sceneTicker } from "../runtime/SceneTicker";
import { useWalkTo } from "./useWalkTo";

const fakeTicker = sceneTicker as unknown as FakeSceneTicker;

const SPEED = HEDGEMONY_CONFIG.speeds.hoglet;

describe("useWalkTo", () => {
  it("starts at the initial target without walking", () => {
    const { result } = renderHook(
      ({ x, y }: { x: number; y: number }) => useWalkTo(x, y),
      { initialProps: { x: 0, y: 0 } },
    );
    expect(result.current.motionX.get()).toBe(0);
    expect(result.current.motionY.get()).toBe(0);
    expect(result.current.isWalking).toBe(false);
  });

  it("walks straight to the target when no transitPath is given", () => {
    const { rerender, result } = renderHook(
      ({ x, y }: { x: number; y: number }) => useWalkTo(x, y),
      { initialProps: { x: 0, y: 0 } },
    );

    act(() => {
      rerender({ x: 100, y: 0 });
    });

    expect(result.current.isWalking).toBe(true);

    const totalMs = (100 / SPEED) * 1000;
    act(() => {
      fakeTicker.step(totalMs);
    });

    expect(result.current.motionX.get()).toBe(100);
    expect(result.current.motionY.get()).toBe(0);
  });

  it("interpolates linearly across a single segment", () => {
    const { rerender, result } = renderHook(
      ({ x, y }: { x: number; y: number }) => useWalkTo(x, y),
      { initialProps: { x: 0, y: 0 } },
    );

    act(() => {
      rerender({ x: 100, y: 0 });
    });

    const totalMs = (100 / SPEED) * 1000;
    act(() => {
      fakeTicker.step(totalMs / 2);
    });

    expect(result.current.motionX.get()).toBeCloseTo(50, 1);
    expect(result.current.motionY.get()).toBe(0);
    expect(result.current.isWalking).toBe(true);
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

    const seg1Ms = (Math.hypot(100, 80) / SPEED) * 1000;
    act(() => {
      fakeTicker.step(seg1Ms);
    });
    expect(result.current.motionX.get()).toBeCloseTo(100, 1);
    expect(result.current.motionY.get()).toBeCloseTo(80, 1);

    const seg2Ms = (Math.hypot(100, 0) / SPEED) * 1000;
    act(() => {
      fakeTicker.step(seg2Ms);
    });
    expect(result.current.motionX.get()).toBeCloseTo(200, 1);
    expect(result.current.motionY.get()).toBeCloseTo(80, 1);

    const seg3Ms = (Math.hypot(100, 80) / SPEED) * 1000;
    act(() => {
      fakeTicker.step(seg3Ms);
    });
    expect(result.current.motionX.get()).toBeCloseTo(300, 1);
    expect(result.current.motionY.get()).toBeCloseTo(0, 1);
    expect(result.current.isWalking).toBe(false);
  });

  it("sets isWalking back to false when the path finishes", () => {
    const { rerender, result } = renderHook(
      ({ x, y }: { x: number; y: number }) => useWalkTo(x, y),
      { initialProps: { x: 0, y: 0 } },
    );

    act(() => {
      rerender({ x: 100, y: 0 });
    });
    expect(result.current.isWalking).toBe(true);

    const totalMs = (100 / SPEED) * 1000;
    act(() => {
      fakeTicker.step(totalMs);
    });
    expect(result.current.isWalking).toBe(false);
  });

  it("flips facing when target is to the left", () => {
    const { rerender, result } = renderHook(
      ({ x, y }: { x: number; y: number }) => useWalkTo(x, y),
      { initialProps: { x: 100, y: 0 } },
    );

    act(() => {
      rerender({ x: 0, y: 0 });
    });
    expect(result.current.facing).toBe("left");
  });
});

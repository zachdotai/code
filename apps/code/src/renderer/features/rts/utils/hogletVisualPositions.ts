import type { MotionValue } from "framer-motion";
import { useEffect } from "react";
import type { HogletWorldPosition } from "./hogletPositions";
import type { Vec2 } from "./pathfinding";

const visualPositions = new Map<string, Vec2>();

function clone(pos: Vec2): Vec2 {
  return { x: pos.x, y: pos.y };
}

export function getHogletVisualPosition(hogletId: string): Vec2 | undefined {
  const pos = visualPositions.get(hogletId);
  return pos ? clone(pos) : undefined;
}

export function applyHogletVisualPositions(
  positions: HogletWorldPosition[],
): HogletWorldPosition[] {
  return positions.map((pos) => {
    const visual = visualPositions.get(pos.hogletId);
    return visual ? { ...pos, x: visual.x, y: visual.y } : pos;
  });
}

// Writer for the collision-resolution loop. It writes the sprite's actual
// on-screen position each animation frame so path planners see the truth
// (motion target + per-frame collision offset), not just the framer
// motionX/motionY. Components that don't participate in collision
// resolution use `useRegisterHogletVisualPosition` instead, which writes
// the raw motion values via subscription.
export function writeHogletVisualPosition(hogletId: string, pos: Vec2): void {
  visualPositions.set(hogletId, clone(pos));
}

export function clearHogletVisualPosition(hogletId: string): void {
  visualPositions.delete(hogletId);
}

export function setHogletVisualPositionForTest(
  hogletId: string,
  pos: Vec2 | null,
): void {
  if (!pos) {
    visualPositions.delete(hogletId);
    return;
  }
  visualPositions.set(hogletId, clone(pos));
}

export function clearHogletVisualPositionsForTest(): void {
  visualPositions.clear();
}

export function useRegisterHogletVisualPosition(
  hogletId: string,
  motionX: MotionValue<number>,
  motionY: MotionValue<number>,
): void {
  useEffect(() => {
    const write = () => {
      visualPositions.set(hogletId, {
        x: motionX.get(),
        y: motionY.get(),
      });
    };

    write();
    const unsubX = motionX.on("change", write);
    const unsubY = motionY.on("change", write);

    return () => {
      unsubX();
      unsubY();
      visualPositions.delete(hogletId);
    };
  }, [hogletId, motionX, motionY]);
}

import { type MotionValue, useMotionValue, useTransform } from "framer-motion";
import { useEffect, useRef } from "react";
import {
  clearHogletVisualPosition,
  writeHogletVisualPosition,
} from "./hogletVisualPositions";
import { type Obstacle, snapPointOutsideObstacles } from "./pathfinding";

/*
 * Global per-frame collision resolution for moving sprites on the
 * Hedgemony map.
 *
 * Pathfinding (findPath + useTransitPath) plans collision-free routes when
 * a target changes, but each sprite then animates along its path
 * independently via framer-motion. Two units whose paths happen to cross
 * at the same time, or who arrive at the same point simultaneously, will
 * overlap visibly because nothing reconciles motion across sprites.
 *
 * This module adds a single rAF loop that, every animation frame:
 *   1. Reads each registered sprite's resolved on-screen position
 *      (framer motion value + cumulative collision offset).
 *   2. Iteratively pushes overlapping sprites apart (boids-style separation
 *      with deterministic tie-break on id pairs so symmetric head-on
 *      collisions don't deadlock).
 *   3. Hard-snaps any sprite still inside a static obstacle (nest /
 *      Hedgehouse) out to its perimeter, so a unit-vs-unit push that
 *      shoves someone into a wall self-corrects.
 *   4. Writes the resulting correction back to per-sprite `offsetX/Y`
 *      motion values and to the shared visualPositions registry, so the
 *      next path replan plans from where the sprite actually is.
 *
 * Components compose the offsets into render by reading the resolved
 * motion values returned by `useCollisionResolvedPosition`.
 */

interface Entity {
  id: string;
  motionX: MotionValue<number>;
  motionY: MotionValue<number>;
  offsetX: MotionValue<number>;
  offsetY: MotionValue<number>;
  radius: number;
  getStaticObstacles: () => Obstacle[];
  visualRegistryId: string | null;
}

const entities = new Map<string, Entity>();
let rafHandle: number | null = null;

const PASSES = 4;
const EPS = 0.001;

function deterministicAngle(aId: string, bId: string): number {
  const seed = `${aId}|${bId}`
    .split("")
    .reduce((s, c) => (s * 31 + c.charCodeAt(0)) | 0, 0);
  return (Math.abs(seed) % 360) * (Math.PI / 180);
}

function tick(): void {
  const list = Array.from(entities.values());
  const positions: Array<{ e: Entity; x: number; y: number }> = list.map(
    (e) => ({
      e,
      x: e.motionX.get() + e.offsetX.get(),
      y: e.motionY.get() + e.offsetY.get(),
    }),
  );

  for (let pass = 0; pass < PASSES; pass++) {
    let moved = false;
    for (let i = 0; i < positions.length; i++) {
      const a = positions[i];
      for (let j = i + 1; j < positions.length; j++) {
        const b = positions[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minDist = a.e.radius + b.e.radius;
        let d = Math.hypot(dx, dy);
        if (d >= minDist) continue;
        let ux: number;
        let uy: number;
        if (d < EPS) {
          // Exact stack: pick a direction deterministically from the id
          // pair so we don't jitter the resolution direction across
          // frames (Math.random would).
          const ang = deterministicAngle(a.e.id, b.e.id);
          ux = Math.cos(ang);
          uy = Math.sin(ang);
          d = 0;
        } else {
          ux = dx / d;
          uy = dy / d;
        }
        const push = (minDist - d) / 2 + 0.01;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
        moved = true;
      }
    }
    if (!moved) break;
  }

  // After unit-vs-unit resolution, push everyone out of static obstacles.
  // This second pass keeps the iterative pairwise push from accidentally
  // settling a sprite inside a nest while it was resolving a head-on.
  for (const p of positions) {
    const obs = p.e.getStaticObstacles();
    if (obs.length === 0) continue;
    const safe = snapPointOutsideObstacles({ x: p.x, y: p.y }, obs, p.e.radius);
    p.x = safe.x;
    p.y = safe.y;
  }

  for (const p of positions) {
    const baseX = p.e.motionX.get();
    const baseY = p.e.motionY.get();
    p.e.offsetX.set(p.x - baseX);
    p.e.offsetY.set(p.y - baseY);
    if (p.e.visualRegistryId !== null) {
      writeHogletVisualPosition(p.e.visualRegistryId, { x: p.x, y: p.y });
    }
  }

  rafHandle = entities.size > 0 ? requestAnimationFrame(tick) : null;
}

function ensureRunning(): void {
  if (rafHandle === null) rafHandle = requestAnimationFrame(tick);
}

interface UseCollisionResolvedOptions {
  /** When set, the resolved on-screen position is written to the
   * hogletVisualPositions registry under this id each frame, so path
   * planners (useTransitPath / unitObstacles) see the truth after
   * collision correction rather than just the raw motion target. */
  visualRegistryId?: string;
}

interface ResolvedMotion {
  resolvedX: MotionValue<number>;
  resolvedY: MotionValue<number>;
}

/**
 * Registers a sprite in the collision-resolution loop and returns motion
 * values that incorporate the per-frame separation offset. Pass these
 * into the rendered `style={{ x, y }}` instead of the raw motion values.
 */
export function useCollisionResolvedPosition(
  id: string,
  motionX: MotionValue<number>,
  motionY: MotionValue<number>,
  radius: number,
  getStaticObstacles: () => Obstacle[],
  options: UseCollisionResolvedOptions = {},
): ResolvedMotion {
  const offsetX = useMotionValue(0);
  const offsetY = useMotionValue(0);
  const resolvedX = useTransform(
    [motionX, offsetX] as MotionValue<number>[],
    ([m, o]: number[]) => m + o,
  );
  const resolvedY = useTransform(
    [motionY, offsetY] as MotionValue<number>[],
    ([m, o]: number[]) => m + o,
  );
  const visualRegistryId = options.visualRegistryId ?? null;

  // Pin the obstacle-snapshot callback in a stable ref so the entity
  // registration effect doesn't re-fire whenever the caller passes in a
  // fresh closure — the tick reads obstacleRef.current() each frame so
  // it always sees the latest obstacle snapshot.
  const obstacleRef = useRef(getStaticObstacles);
  obstacleRef.current = getStaticObstacles;

  useEffect(() => {
    entities.set(id, {
      id,
      motionX,
      motionY,
      offsetX,
      offsetY,
      radius,
      getStaticObstacles: () => obstacleRef.current(),
      visualRegistryId,
    });
    ensureRunning();
    return () => {
      entities.delete(id);
      offsetX.set(0);
      offsetY.set(0);
      if (visualRegistryId !== null)
        clearHogletVisualPosition(visualRegistryId);
    };
  }, [id, motionX, motionY, offsetX, offsetY, radius, visualRegistryId]);

  return { resolvedX, resolvedY };
}

// Test hooks — let tests inspect / clear the registry without exporting
// the entity map.
export function getCollisionEntityCountForTest(): number {
  return entities.size;
}
export function clearCollisionEntitiesForTest(): void {
  entities.clear();
  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
}
export function stepCollisionResolutionForTest(): void {
  // Single deterministic tick — drives the resolution from tests without
  // depending on rAF.
  tick();
}

// Direct entity registration for tests that want to exercise the
// resolution algorithm without React / framer-motion. The caller provides
// minimal motion-value-like stubs.
interface MotionValueLike {
  get(): number;
  set(v: number): void;
}
export function registerCollisionEntityForTest(args: {
  id: string;
  motionX: MotionValueLike;
  motionY: MotionValueLike;
  offsetX: MotionValueLike;
  offsetY: MotionValueLike;
  radius: number;
  getStaticObstacles?: () => Obstacle[];
  visualRegistryId?: string;
}): void {
  entities.set(args.id, {
    id: args.id,
    motionX: args.motionX as MotionValue<number>,
    motionY: args.motionY as MotionValue<number>,
    offsetX: args.offsetX as MotionValue<number>,
    offsetY: args.offsetY as MotionValue<number>,
    radius: args.radius,
    getStaticObstacles: args.getStaticObstacles ?? (() => []),
    visualRegistryId: args.visualRegistryId ?? null,
  });
}

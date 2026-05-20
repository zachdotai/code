import { useEffect, useMemo, useRef } from "react";
import { useHogletPositionStore } from "../stores/hogletPositionStore";
import { useHogletStore } from "../stores/hogletStore";
import { selectNests, useNestStore } from "../stores/nestStore";
import { collectHogletWorldPositions } from "../utils/hogletPositions";
import {
  applyHogletVisualPositions,
  getHogletVisualPosition,
} from "../utils/hogletVisualPositions";
import { findPath, type Vec2 } from "../utils/pathfinding";
import { hogletObstacles, worldObstacles } from "../utils/worldObstacles";

/**
 * Routes a sprite's `(targetX, targetY)` change through `findPath` so it walks
 * around structures and other hoglets instead of clipping through them.
 * Returns `undefined` on first mount (the sprite is just appearing — no walk)
 * and when the target hasn't moved.
 *
 * Pass `enabled=false` when an explicit walk path is already supplied by the
 * caller (e.g. the multi-select right-click flow, which plans formations in
 * one shot in `HedgemonyMapView`). That path wins.
 *
 * Without this hook, every hoglet (x, y) change that *isn't* a right-click —
 * brood ring re-layout when siblings join/leave, adoption-to-nest, wild ring
 * re-shuffles on spawn — fell through to `useWalkTo`'s straight-line tween
 * and cut through nests/the Hedgehouse.
 */
export function useTransitPath(
  targetX: number,
  targetY: number,
  agentRadius: number,
  enabled: boolean,
  excludeHogletId?: string,
): Vec2[] | undefined {
  const nests = useNestStore(selectNests);
  const byBucket = useHogletStore((s) => s.byBucket);
  const positionOverrides = useHogletPositionStore((s) => s.positions);
  const prevRef = useRef<{ x: number; y: number } | null>(null);

  const path = useMemo(() => {
    if (!enabled) return undefined;
    // Plan from the sprite's live on-screen position when we have it.
    // Falling back to prevRef (the previous target) means a mid-walk
    // re-target would plan from where the sprite *was going*, not where it
    // *is* — the new path[1..N] could cut straight across an obstacle that
    // sits between the sprite's actual location and the first waypoint.
    const live = excludeHogletId
      ? getHogletVisualPosition(excludeHogletId)
      : undefined;
    const prev = live ?? prevRef.current;
    if (!prev) return undefined;
    if (prev.x === targetX && prev.y === targetY) return undefined;
    const obstacles = [
      ...worldObstacles(nests),
      ...hogletObstacles(
        applyHogletVisualPositions(
          collectHogletWorldPositions(nests, byBucket, positionOverrides),
        ),
        excludeHogletId ? new Set([excludeHogletId]) : undefined,
      ),
    ];
    const result = findPath(
      prev,
      { x: targetX, y: targetY },
      obstacles,
      agentRadius,
    );
    return result.length > 1 ? result : undefined;
  }, [
    targetX,
    targetY,
    agentRadius,
    enabled,
    nests,
    byBucket,
    positionOverrides,
    excludeHogletId,
  ]);

  useEffect(() => {
    prevRef.current = { x: targetX, y: targetY };
  }, [targetX, targetY]);

  return path;
}

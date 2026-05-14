import { useEffect, useMemo, useRef } from "react";
import { selectNests, useNestStore } from "../stores/nestStore";
import { findPath, type Vec2 } from "../utils/pathfinding";
import { worldObstacles } from "../utils/worldObstacles";

/**
 * Routes a sprite's `(targetX, targetY)` change through `findPath` so it walks
 * around nests + the Hedgehouse instead of clipping through them. Returns
 * `undefined` on first mount (the sprite is just appearing — no walk) and
 * when the target hasn't moved.
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
): Vec2[] | undefined {
  const nests = useNestStore(selectNests);
  const prevRef = useRef<{ x: number; y: number } | null>(null);

  const path = useMemo(() => {
    if (!enabled) return undefined;
    const prev = prevRef.current;
    if (!prev) return undefined;
    if (prev.x === targetX && prev.y === targetY) return undefined;
    const obstacles = worldObstacles(nests);
    const result = findPath(
      prev,
      { x: targetX, y: targetY },
      obstacles,
      agentRadius,
    );
    return result.length > 1 ? result : undefined;
  }, [targetX, targetY, agentRadius, enabled, nests]);

  useEffect(() => {
    prevRef.current = { x: targetX, y: targetY };
  }, [targetX, targetY]);

  return path;
}

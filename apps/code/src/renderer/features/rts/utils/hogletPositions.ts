import type { Hoglet, Nest } from "@main/services/rts/schemas";
import { RTS_CONFIG } from "../config";
import { WILD_BUCKET } from "../constants/buckets";
import { snapPointOutsideObstacles, type Vec2 } from "./pathfinding";
import { HOGLET_RADIUS, worldObstacles } from "./worldObstacles";

const COLLISION_ITERATIONS = 18;
const POSITION_EPSILON = 0.01;
const WILD_RING_INNER = RTS_CONFIG.layout.wildRingInner;
const WILD_RING_THICKNESS = RTS_CONFIG.layout.wildRingThickness;
// Brood hoglets sit in a ring around their nest. This is deliberately derived
// from the shared obstacle radii so the static layout and right-click movement
// agree on where "outside the nest" begins.
const BROOD_RADIUS = RTS_CONFIG.layout.broodRadius;

function hashToUnit(id: string, seed: number): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export function wildHogletPosition(hogletId: string): { x: number; y: number } {
  const angle = hashToUnit(hogletId, 0) * Math.PI * 2;
  const radius =
    WILD_RING_INNER + hashToUnit(hogletId, 7) * WILD_RING_THICKNESS;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

export function broodHogletPosition(
  index: number,
  total: number,
  origin: { x: number; y: number },
): { x: number; y: number } {
  const safeTotal = Math.max(total, 1);
  const angle = -Math.PI / 2 + (2 * Math.PI * index) / safeTotal;
  return {
    x: origin.x + Math.cos(angle) * BROOD_RADIUS,
    y: origin.y + Math.sin(angle) * BROOD_RADIUS,
  };
}

export function avoidHogletObstacleCollision(
  position: Vec2,
  nests: Nest[],
): Vec2 {
  return snapPointOutsideObstacles(
    position,
    worldObstacles(nests),
    HOGLET_RADIUS,
  );
}

function sortByCreated(hoglets: Hoglet[]): Hoglet[] {
  return [...hoglets].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

export interface HogletWorldPosition {
  hogletId: string;
  x: number;
  y: number;
}

function hasMoved(a: Vec2, b: Vec2): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) > POSITION_EPSILON;
}

function pairDirection(a: string, b: string): Vec2 {
  const angle = hashToUnit(`${a}:${b}`, 19) * Math.PI * 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

export function resolveHogletLayoutCollisions(
  positions: HogletWorldPosition[],
  nests: Nest[],
): HogletWorldPosition[] {
  const obstacles = worldObstacles(nests);
  const resolved = positions.map((pos) => {
    const snapped = snapPointOutsideObstacles(pos, obstacles, HOGLET_RADIUS);
    return { ...pos, x: snapped.x, y: snapped.y };
  });

  for (let iteration = 0; iteration < COLLISION_ITERATIONS; iteration++) {
    let moved = false;

    for (const pos of resolved) {
      const snapped = snapPointOutsideObstacles(pos, obstacles, HOGLET_RADIUS);
      if (hasMoved(pos, snapped)) {
        pos.x = snapped.x;
        pos.y = snapped.y;
        moved = true;
      }
    }

    for (let i = 0; i < resolved.length; i++) {
      for (let j = i + 1; j < resolved.length; j++) {
        const a = resolved[i];
        const b = resolved[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        let ux: number;
        let uy: number;

        if (dist < POSITION_EPSILON) {
          const dir = pairDirection(a.hogletId, b.hogletId);
          ux = dir.x;
          uy = dir.y;
          dist = 0;
        } else {
          ux = dx / dist;
          uy = dy / dist;
        }

        const minDist = HOGLET_RADIUS * 2;
        if (dist >= minDist) continue;

        const push = (minDist - dist) / 2;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
        moved = true;
      }
    }

    for (const pos of resolved) {
      const snapped = snapPointOutsideObstacles(pos, obstacles, HOGLET_RADIUS);
      if (hasMoved(pos, snapped)) {
        pos.x = snapped.x;
        pos.y = snapped.y;
        moved = true;
      }
    }

    if (!moved) break;
  }

  return resolved;
}

/**
 * Compute the on-map world position for every hoglet currently rendered on the
 * surface — wild flock + nest broods. Mirrors the layout logic in
 * `WildHogletFlock` and `NestBroodCluster` so callers (e.g. box-select) can
 * hit-test against the same coordinates the user sees. Signal-backed wild
 * hoglets are included; they share the wild bucket with ad-hoc spawns.
 */
export function collectHogletWorldPositions(
  nests: Nest[],
  byBucket: Record<string, Hoglet[]>,
  overrides: Record<string, { x: number; y: number }>,
): HogletWorldPosition[] {
  const base: HogletWorldPosition[] = [];

  const wild = byBucket[WILD_BUCKET] ?? [];
  for (const hoglet of sortByCreated(wild)) {
    const override = overrides[hoglet.id];
    const pos = override ?? wildHogletPosition(hoglet.id);
    base.push({ hogletId: hoglet.id, x: pos.x, y: pos.y });
  }

  for (const nest of nests) {
    const brood = byBucket[nest.id] ?? [];
    const ordered = sortByCreated(brood);
    ordered.forEach((hoglet, index) => {
      const override = overrides[hoglet.id];
      const pos =
        override ??
        broodHogletPosition(index, ordered.length, {
          x: nest.mapX,
          y: nest.mapY,
        });
      base.push({ hogletId: hoglet.id, x: pos.x, y: pos.y });
    });
  }

  return resolveHogletLayoutCollisions(base, nests);
}

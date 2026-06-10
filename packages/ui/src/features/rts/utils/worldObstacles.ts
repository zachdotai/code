import type { Nest } from "@posthog/host-router/rts-schemas";
import { RTS_CONFIG } from "../config";
import { HEDGEHOUSE_MAP_X, HEDGEHOUSE_MAP_Y } from "../constants/map";
import type { Obstacle } from "./pathfinding";

// Shared collision radii for everything that should block walking/resting —
// kept here so the builder coordinator, hoglet move handler, and static
// hoglet layout agree on what is solid. The painted nest art fills roughly
// the whole 140px sprite; this radius includes the white rim/drop shadow so
// hoglets do not park half-inside the wreath.
export const NEST_OBSTACLE_RADIUS = RTS_CONFIG.radii.nest;
// The Hedgehouse is the biggest structure on the map (220px). Without this
// entry, agents walked straight through it — pathfinding was added before
// the Hedgehouse existed and never picked it up.
export const HEDGEHOUSE_OBSTACLE_RADIUS = RTS_CONFIG.radii.hedgehouse;
// Buffer past the visible hoglet sprite so the art, nameplate, and hover target
// never overlap an obstacle after path-snapping. Wild hoglets are 40px, brood
// are 44px; 44 leaves room for the pixel art plus the small label below it.
export const HOGLET_RADIUS = RTS_CONFIG.radii.hoglet;
// The builder sprite is larger than hoglets (72px). Treat its center as a
// solid circle so hoglets do not path directly through it.
export const BUILDER_OBSTACLE_RADIUS = RTS_CONFIG.radii.builder;

export interface HogletObstaclePosition {
  hogletId: string;
  x: number;
  y: number;
}

interface WorldObstacleOptions {
  /** A nest the builder is en-route to construct. Not in `nests` yet, but
   * needs to be treated as solid so the builder snaps to the perimeter
   * instead of standing on top of the eventual sprite. */
  pendingNest?: Nest | null;
}

export function worldObstacles(
  nests: Nest[],
  { pendingNest }: WorldObstacleOptions = {},
): Obstacle[] {
  const obstacles: Obstacle[] = nests.map((nest) => ({
    x: nest.mapX,
    y: nest.mapY,
    radius: NEST_OBSTACLE_RADIUS,
  }));
  if (pendingNest) {
    obstacles.push({
      x: pendingNest.mapX,
      y: pendingNest.mapY,
      radius: NEST_OBSTACLE_RADIUS,
    });
  }
  obstacles.push({
    x: HEDGEHOUSE_MAP_X,
    y: HEDGEHOUSE_MAP_Y,
    radius: HEDGEHOUSE_OBSTACLE_RADIUS,
  });
  return obstacles;
}

export function hogletObstacles(
  positions: HogletObstaclePosition[],
  excludeIds: ReadonlySet<string> = new Set(),
): Obstacle[] {
  return positions
    .filter((pos) => !excludeIds.has(pos.hogletId))
    .map((pos) => ({
      x: pos.x,
      y: pos.y,
      radius: HOGLET_RADIUS,
    }));
}

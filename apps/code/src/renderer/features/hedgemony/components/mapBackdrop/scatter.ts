import type { Nest } from "@main/services/hedgemony/schemas";
import {
  HEDGEHOUSE_AVOID_RADIUS,
  HEDGEHOUSE_MAP_X,
  HEDGEHOUSE_MAP_Y,
} from "../HedgehouseSprite";
import {
  findZoneFor,
  PROPS_DEFAULT,
  PROPS_DEFAULT_DEFAULT,
  type PropType,
  type PropWeights,
  ZONES,
} from "./zones";

const WORLD = 4000;
const HALF = WORLD / 2;
const SCATTER_SEED = 20251114;

export interface PropInstance {
  type: PropType;
  x: number;
  y: number;
  scale: number;
  flip: boolean;
}

export function makeRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function insideEllipse(
  x: number,
  y: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
) {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy < 1;
}

export function pickProp(
  roll: number,
  weights: PropWeights,
  fallback: PropType,
): PropType {
  for (const [threshold, type] of weights) {
    if (roll < threshold) return type;
  }
  return fallback;
}

export function scatterProps(nests: Nest[]): PropInstance[] {
  const rng = makeRng(SCATTER_SEED);
  const out: PropInstance[] = [];
  const step = 195;
  for (let gy = -HALF + 110; gy < HALF - 110; gy += step) {
    for (let gx = -HALF + 110; gx < HALF - 110; gx += step) {
      const x = gx + (rng() - 0.5) * step * 1.4;
      const y = gy + (rng() - 0.5) * step * 1.4;
      if (Math.hypot(x, y) > HALF - 90) continue;
      if (Math.hypot(x, y) < 210) continue;
      if (rng() < 0.16) continue;
      const zoneId = findZoneFor(x, y);
      if (zoneId === "active" && rng() < 0.55) continue;
      if (nests.some((n) => Math.hypot(n.mapX - x, n.mapY - y) < 150)) continue;
      if (
        Math.hypot(x - HEDGEHOUSE_MAP_X, y - HEDGEHOUSE_MAP_Y) <
        HEDGEHOUSE_AVOID_RADIUS
      ) {
        continue;
      }
      const roll = rng();
      const zone = zoneId ? ZONES.find((z) => z.id === zoneId) : undefined;
      const type = zone
        ? pickProp(roll, zone.propWeights, zone.propWeightsDefault)
        : pickProp(roll, PROPS_DEFAULT, PROPS_DEFAULT_DEFAULT);
      out.push({
        type,
        x,
        y,
        scale: 0.78 + rng() * 0.5,
        flip: rng() > 0.5,
      });
    }
  }
  // Painter's algorithm — things further "back" (lower y) render first.
  out.sort((a, b) => a.y - b.y);
  return out;
}

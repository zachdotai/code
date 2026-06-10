export type PropType =
  | "oak"
  | "pine"
  | "bush"
  | "bushLg"
  | "boulder"
  | "boulderLg"
  | "stump"
  | "wildflower"
  | "mushroom";

/**
 * Sorted [threshold, type] pairs: walk in order, return the first whose
 * threshold the roll falls under. The trailing default catches `roll ≥` the
 * last threshold so every cell picks something.
 */
export type PropWeights = readonly [number, PropType][];

export type ZoneId = "active" | "wilds" | "staging";

export interface Zone {
  id: ZoneId;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotation: number;
  variant: "primary" | "muted";
  propWeights: PropWeights;
  propWeightsDefault: PropType;
}

export const ZONES: Zone[] = [
  {
    id: "active",
    cx: 0,
    cy: 0,
    rx: 950,
    ry: 640,
    rotation: -3,
    variant: "primary",
    propWeights: [
      [0.32, "wildflower"],
      [0.55, "bush"],
      [0.72, "bushLg"],
      [0.86, "oak"],
      [0.94, "mushroom"],
    ],
    propWeightsDefault: "stump",
  },
  {
    id: "wilds",
    cx: -1220,
    cy: 860,
    rx: 440,
    ry: 260,
    rotation: 8,
    variant: "muted",
    propWeights: [
      [0.42, "oak"],
      [0.68, "pine"],
      [0.82, "bushLg"],
      [0.9, "bush"],
      [0.95, "boulder"],
    ],
    propWeightsDefault: "stump",
  },
  {
    id: "staging",
    cx: 1180,
    cy: -820,
    rx: 450,
    ry: 270,
    rotation: -6,
    variant: "muted",
    propWeights: [
      [0.28, "boulder"],
      [0.5, "boulderLg"],
      [0.68, "pine"],
      [0.82, "oak"],
      [0.92, "stump"],
    ],
    propWeightsDefault: "mushroom",
  },
];

export const PROPS_DEFAULT: PropWeights = [
  [0.3, "oak"],
  [0.54, "pine"],
  [0.7, "bushLg"],
  [0.8, "bush"],
  [0.87, "boulder"],
  [0.92, "boulderLg"],
  [0.96, "stump"],
  [0.99, "wildflower"],
];
export const PROPS_DEFAULT_DEFAULT: PropType = "mushroom";

export function findZoneFor(x: number, y: number): ZoneId | null {
  for (const z of ZONES) {
    const dx = (x - z.cx) / z.rx;
    const dy = (y - z.cy) / z.ry;
    if (dx * dx + dy * dy < 1) return z.id;
  }
  return null;
}

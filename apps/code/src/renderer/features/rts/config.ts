/**
 * Centralized tuning constants for hedgemony. Every magic number that
 * affects gameplay feel — speeds, radii, polling cadence, animation timing,
 * camera bounds — lives here so the simulation can be tuned in one place
 * instead of chasing literals across a dozen files.
 *
 * Derived geometry (e.g. WILD_RING_INNER) is computed at module load so
 * static consumers can read a single number, while still expressing the
 * relationship between the inputs.
 */

const HEDGEHOUSE_RADIUS = 100;
const NEST_RADIUS = 86;
const HOGLET_RADIUS = 44;
const BUILDER_RADIUS = 36;
const OBSTACLE_CLEARANCE = 28;

export const HEDGEMONY_CONFIG = {
  speeds: {
    builder: 150,
    nest: 100,
    hoglet: 120,
    panCamera: 950,
  },
  radii: {
    builder: BUILDER_RADIUS,
    hoglet: HOGLET_RADIUS,
    nest: NEST_RADIUS,
    hedgehouse: HEDGEHOUSE_RADIUS,
  },
  layout: {
    wildRingInner: HEDGEHOUSE_RADIUS + HOGLET_RADIUS + OBSTACLE_CLEARANCE,
    wildRingThickness: 90,
    broodRadius: NEST_RADIUS + HOGLET_RADIUS + OBSTACLE_CLEARANCE,
    obstacleClearance: OBSTACLE_CLEARANCE,
  },
  animation: {
    buildMs: 1500,
    moveMarkerMs: 600,
    fps: { idle: 8, walk: 14, action: 12 },
  },
  polling: {
    signalIngestionMs: 30_000,
    taskSummaryMs: 10_000,
    prStatusStaleMs: 30_000,
  },
  camera: {
    zoomMin: 0.25,
    zoomMax: 2,
    animDurationS: 0.42,
    // Material Design "standard" cubic-bezier — gentle ease-out that reads as a
    // confident snap without feeling abrupt.
    ease: [0.4, 0, 0.2, 1] as [number, number, number, number],
  },
} as const;

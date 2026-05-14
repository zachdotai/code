import type {
  Nest,
  Overlap,
  OverlapKind,
} from "@main/services/hedgemony/schemas";
import { useMemo } from "react";
import { useFederationStore } from "../stores/federationStore";
import { selectNests, useNestStore } from "../stores/nestStore";

/**
 * Cross-nest overlap visualization. Renders a faint cubic-bezier arc between
 * each pair of nests that share an unresolved overlap, colored by kind. Sits
 * inside the same world-space `motion.div` as the nest sprites so arc
 * coordinates match nest coordinates directly. Layered ABOVE the terrain but
 * BELOW the nest/hoglet sprite layer; `pointer-events-none` on the SVG group
 * so the arcs never steal clicks from units underneath.
 *
 * Multiple overlap kinds between the same pair of nests get unique bow offsets
 * (perpendicular to the chord) so the arcs splay out instead of stacking.
 */
export function OverlapArcs() {
  const overlayVisible = useFederationStore((s) => s.overlayVisible);
  const overlapsById = useFederationStore((s) => s.overlapsById);
  const nests = useNestStore(selectNests);

  const nestById = useMemo(() => {
    const map = new Map<string, Nest>();
    for (const nest of nests) map.set(nest.id, nest);
    return map;
  }, [nests]);

  const resolvedArcs = useMemo(() => {
    if (!overlayVisible) return [] as ResolvedArc[];
    return Object.values(overlapsById)
      .map((overlap) => buildArc(overlap, nestById))
      .filter((arc): arc is ResolvedArc => arc !== null);
  }, [overlayVisible, overlapsById, nestById]);

  if (!overlayVisible || resolvedArcs.length === 0) return null;

  return (
    <div
      aria-hidden
      data-testid="overlap-arcs"
      className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-1/2"
      style={{ width: ARC_HALF * 2, height: ARC_HALF * 2 }}
    >
      <svg
        role="img"
        aria-label="Cross-nest overlap arcs"
        width={ARC_HALF * 2}
        height={ARC_HALF * 2}
        viewBox={`0 0 ${ARC_HALF * 2} ${ARC_HALF * 2}`}
        fill="none"
        className="pointer-events-none"
      >
        {resolvedArcs.map((arc) => (
          <path
            key={arc.id}
            data-overlap-id={arc.id}
            data-overlap-kind={arc.kind}
            d={arc.path}
            stroke={ARC_STROKE[arc.kind]}
            strokeWidth={arc.strokeWidth}
            strokeOpacity={arc.opacity}
            strokeLinecap="round"
          />
        ))}
      </svg>
    </div>
  );
}

/**
 * Half-side of the SVG canvas. Same trick as `NestPrGraphOverlay`: we anchor
 * the SVG at world (0,0) and shift each endpoint by `ARC_HALF` so coordinates
 * stay positive inside the viewBox.
 */
const ARC_HALF = 4000;

/** Stroke colors translucent-by-default; alpha is applied via strokeOpacity. */
const ARC_STROKE: Record<OverlapKind, string> = {
  goal_embedding: "var(--violet-9)",
  pr_graph: "var(--amber-9)",
  chat_xref: "var(--cyan-9)",
  signal_runnerup: "var(--blue-9)",
  scratchpad: "var(--gray-9)",
};

/**
 * Per-kind perpendicular bow offset multiplier. Two arcs between the same pair
 * of nests but different kinds bow to different sides / distances so they
 * don't overlap. Values are chosen to splay arcs apart visibly without
 * arching off-screen at typical nest spacing.
 */
const BOW_OFFSET: Record<OverlapKind, number> = {
  goal_embedding: 0.18,
  pr_graph: -0.18,
  chat_xref: 0.32,
  signal_runnerup: -0.32,
  scratchpad: 0,
};

const STROKE_WIDTH_MIN = 1.5;
const STROKE_WIDTH_MAX = 5;
const OPACITY_MIN = 0.18;
const OPACITY_MAX = 0.55;

interface ResolvedArc {
  id: string;
  kind: OverlapKind;
  path: string;
  strokeWidth: number;
  opacity: number;
}

function buildArc(
  overlap: Overlap,
  nestById: Map<string, Nest>,
): ResolvedArc | null {
  if (overlap.resolvedAt !== null) return null;
  const a = nestById.get(overlap.nestAId);
  const b = nestById.get(overlap.nestBId);
  if (!a || !b) return null;

  const ax = a.mapX + ARC_HALF;
  const ay = a.mapY + ARC_HALF;
  const bx = b.mapX + ARC_HALF;
  const by = b.mapY + ARC_HALF;

  // Perpendicular to the chord, normalized; scaled by the chord length and the
  // per-kind multiplier so longer chords bow proportionally. A flat (zero-
  // length) pair gets a straight line — fine for visualization.
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  const px = len === 0 ? 0 : -dy / len;
  const py = len === 0 ? 0 : dx / len;
  const bow = len * BOW_OFFSET[overlap.kind];
  const mx = (ax + bx) / 2 + px * bow;
  const my = (ay + by) / 2 + py * bow;

  const score = clamp01(overlap.score);
  const strokeWidth =
    STROKE_WIDTH_MIN + (STROKE_WIDTH_MAX - STROKE_WIDTH_MIN) * score;
  const opacity = OPACITY_MIN + (OPACITY_MAX - OPACITY_MIN) * score;

  return {
    id: overlap.id,
    kind: overlap.kind,
    path: `M ${ax} ${ay} Q ${mx} ${my} ${bx} ${by}`,
    strokeWidth,
    opacity,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

import type { Nest } from "@posthog/host-router/rts-schemas";
import { type MouseEvent, useMemo } from "react";
import { useHogletPositionStore } from "../stores/hogletPositionStore";
import { useHogletStore } from "../stores/hogletStore";
import { selectNests, useNestStore } from "../stores/nestStore";
import { collectHogletWorldPositions } from "../utils/hogletPositions";
import { applyHogletVisualPositions } from "../utils/hogletVisualPositions";
import type { Vec2 } from "../utils/pathfinding";
import { scatterProps } from "./mapBackdrop/scatter";
import type { PropType } from "./mapBackdrop/zones";

const WORLD_HALF = 1600;
const WORLD_MIN = -WORLD_HALF;
const WORLD_SIZE = WORLD_HALF * 2;

interface RtsMinimapProps {
  nests: Nest[];
  builderPos: Vec2;
  panX: number;
  panY: number;
  zoom: number;
  viewportWidth: number;
  viewportHeight: number;
  width: number;
  height: number;
  onJump: (worldX: number, worldY: number) => void;
}

function nestDotColor(nest: Nest): string {
  if (nest.health !== "ok") return "var(--orange-9)";
  if (nest.status === "needs_attention") return "var(--red-9)";
  if (nest.status === "dormant") return "var(--gray-8)";
  if (nest.status === "validated") return "var(--green-9)";
  return "var(--amber-9)";
}

const PROP_DOT: Record<PropType, { fill: string; r: number }> = {
  oak: { fill: "#2a4f30", r: 1.2 },
  pine: { fill: "#1f3a26", r: 1.0 },
  bush: { fill: "#3a6638", r: 0.7 },
  bushLg: { fill: "#3a6638", r: 0.9 },
  boulder: { fill: "#75766d", r: 0.8 },
  boulderLg: { fill: "#75766d", r: 1.0 },
  stump: { fill: "#6f4d2e", r: 0.6 },
  wildflower: { fill: "#f3c84a", r: 0.5 },
  mushroom: { fill: "#c93b2e", r: 0.5 },
};

function worldToMinimap(wx: number, wy: number, width: number, height: number) {
  return {
    x: ((wx - WORLD_MIN) / WORLD_SIZE) * width,
    y: ((wy - WORLD_MIN) / WORLD_SIZE) * height,
  };
}

export function RtsMinimap({
  nests,
  builderPos,
  panX,
  panY,
  zoom,
  viewportWidth,
  viewportHeight,
  width,
  height,
  onJump,
}: RtsMinimapProps) {
  const byBucket = useHogletStore((s) => s.byBucket);
  const positionOverrides = useHogletPositionStore((s) => s.positions);
  const nestsForPositions = useNestStore(selectNests);

  const props = useMemo(() => scatterProps(nests), [nests]);

  const hogletPositions = useMemo(
    () =>
      applyHogletVisualPositions(
        collectHogletWorldPositions(
          nestsForPositions,
          byBucket,
          positionOverrides,
        ),
      ),
    [nestsForPositions, byBucket, positionOverrides],
  );

  const viewWorldW = viewportWidth / zoom;
  const viewWorldH = viewportHeight / zoom;
  const viewCenterWx = -panX / zoom;
  const viewCenterWy = -panY / zoom;
  const viewMinWx = viewCenterWx - viewWorldW / 2;
  const viewMinWy = viewCenterWy - viewWorldH / 2;

  const viewRect = {
    x: Math.max(0, ((viewMinWx - WORLD_MIN) / WORLD_SIZE) * width),
    y: Math.max(0, ((viewMinWy - WORLD_MIN) / WORLD_SIZE) * height),
    w: Math.min(width, (viewWorldW / WORLD_SIZE) * width),
    h: Math.min(height, (viewWorldH / WORLD_SIZE) * height),
  };

  const builderPoint = worldToMinimap(
    builderPos.x,
    builderPos.y,
    width,
    height,
  );

  const handleClick = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const worldX = (localX / width) * WORLD_SIZE + WORLD_MIN;
    const worldY = (localY / height) * WORLD_SIZE + WORLD_MIN;
    onJump(worldX, worldY);
  };

  return (
    <div
      className="overflow-hidden rounded-(--radius-2) border border-(--gray-6) bg-(--gray-1)/85 shadow-md backdrop-blur-sm"
      style={{ width, height }}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: click position is the input; no sensible keyboard equivalent for spatial jump */}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className="block cursor-crosshair"
        onClick={handleClick}
      >
        <title>World minimap</title>
        <defs>
          <radialGradient id="mm-meadow">
            <stop offset="0%" stopColor="#5a8f4a" />
            <stop offset="100%" stopColor="#436c41" />
          </radialGradient>
          <radialGradient id="mm-zone-primary">
            <stop offset="0%" stopColor="#6aad55" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#6aad55" stopOpacity={0} />
          </radialGradient>
          <radialGradient id="mm-zone-muted">
            <stop offset="0%" stopColor="#3d5e3a" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#3d5e3a" stopOpacity={0} />
          </radialGradient>
          <radialGradient id="mm-vignette">
            <stop offset="60%" stopColor="black" stopOpacity={0} />
            <stop offset="100%" stopColor="black" stopOpacity={0.4} />
          </radialGradient>
        </defs>
        {/* Ground base */}
        <rect x={0} y={0} width={width} height={height} fill="#436c41" />
        {/* Meadow center */}
        {(() => {
          const c = worldToMinimap(0, 0, width, height);
          const rx = (950 / WORLD_SIZE) * width;
          const ry = (640 / WORLD_SIZE) * height;
          return (
            <ellipse cx={c.x} cy={c.y} rx={rx} ry={ry} fill="url(#mm-meadow)" />
          );
        })()}
        {/* Zone: Wilds */}
        {(() => {
          const c = worldToMinimap(-1220, 860, width, height);
          const rx = (440 / WORLD_SIZE) * width;
          const ry = (260 / WORLD_SIZE) * height;
          return (
            <ellipse
              cx={c.x}
              cy={c.y}
              rx={rx}
              ry={ry}
              fill="url(#mm-zone-muted)"
            />
          );
        })()}
        {/* Zone: Signal staging */}
        {(() => {
          const c = worldToMinimap(1180, -820, width, height);
          const rx = (450 / WORLD_SIZE) * width;
          const ry = (270 / WORLD_SIZE) * height;
          return (
            <ellipse
              cx={c.x}
              cy={c.y}
              rx={rx}
              ry={ry}
              fill="url(#mm-zone-muted)"
            />
          );
        })()}
        {/* Scattered props (trees, bushes, boulders) */}
        {props.map((p) => {
          const pt = worldToMinimap(p.x, p.y, width, height);
          const dot = PROP_DOT[p.type];
          return (
            <circle
              key={`${p.type}-${Math.round(p.x)}-${Math.round(p.y)}`}
              cx={pt.x}
              cy={pt.y}
              r={dot.r}
              fill={dot.fill}
              opacity={0.7}
            />
          );
        })}
        {/* Hedgehouse */}
        {(() => {
          const hh = worldToMinimap(0, 0, width, height);
          return (
            <g>
              <rect
                x={hh.x - 3.5}
                y={hh.y - 3}
                width={7}
                height={6}
                rx={1}
                fill="#d4a574"
                stroke="#8b6244"
                strokeWidth={0.5}
              />
              <polygon
                points={`${hh.x - 4.5},${hh.y - 3} ${hh.x},${hh.y - 6} ${hh.x + 4.5},${hh.y - 3}`}
                fill="#8b4432"
                stroke="#6b3222"
                strokeWidth={0.4}
              />
            </g>
          );
        })()}
        {/* Vignette overlay */}
        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill="url(#mm-vignette)"
        />
        {hogletPositions.map((hp) => {
          const point = worldToMinimap(hp.x, hp.y, width, height);
          return (
            <circle
              key={hp.hogletId}
              cx={point.x}
              cy={point.y}
              r={1.5}
              fill="var(--violet-9)"
            />
          );
        })}
        {nests.map((nest) => {
          const point = worldToMinimap(nest.mapX, nest.mapY, width, height);
          return (
            <circle
              key={nest.id}
              cx={point.x}
              cy={point.y}
              r={3}
              fill={nestDotColor(nest)}
              stroke="var(--gray-1)"
              strokeWidth={0.5}
            />
          );
        })}
        <circle
          cx={builderPoint.x}
          cy={builderPoint.y}
          r={2.5}
          fill="var(--cyan-10)"
          stroke="var(--gray-1)"
          strokeWidth={0.5}
        />
        <rect
          x={viewRect.x}
          y={viewRect.y}
          width={viewRect.w}
          height={viewRect.h}
          fill="none"
          stroke="var(--accent-10)"
          strokeWidth={1.5}
          pointerEvents="none"
        />
      </svg>
    </div>
  );
}

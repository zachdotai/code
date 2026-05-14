import type { Nest } from "@main/services/hedgemony/schemas";
import { type MouseEvent, useMemo } from "react";
import { useHogletPositionStore } from "../stores/hogletPositionStore";
import { useHogletStore } from "../stores/hogletStore";
import { selectNests, useNestStore } from "../stores/nestStore";
import { collectHogletWorldPositions } from "../utils/hogletPositions";
import { applyHogletVisualPositions } from "../utils/hogletVisualPositions";
import type { Vec2 } from "../utils/pathfinding";

const WORLD_HALF = 1600;
const WORLD_MIN = -WORLD_HALF;
const WORLD_SIZE = WORLD_HALF * 2;

interface HedgemonyMinimapProps {
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

function worldToMinimap(wx: number, wy: number, width: number, height: number) {
  return {
    x: ((wx - WORLD_MIN) / WORLD_SIZE) * width,
    y: ((wy - WORLD_MIN) / WORLD_SIZE) * height,
  };
}

export function HedgemonyMinimap({
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
}: HedgemonyMinimapProps) {
  const byBucket = useHogletStore((s) => s.byBucket);
  const positionOverrides = useHogletPositionStore((s) => s.positions);
  const nestsForPositions = useNestStore(selectNests);

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
        <rect x={0} y={0} width={width} height={height} fill="var(--gray-3)" />
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

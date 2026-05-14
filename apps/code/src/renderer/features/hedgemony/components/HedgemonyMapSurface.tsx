import type { Nest } from "@main/services/hedgemony/schemas";
import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { AnimatePresence, motion, useMotionValue } from "framer-motion";
import type { MutableRefObject, ReactNode } from "react";
import { useRef, useState } from "react";
import {
  HEDGEMONY_ZOOM_MAX,
  HEDGEMONY_ZOOM_MIN,
  useHedgemonyViewStore,
} from "../stores/hedgemonyViewStore";
import type { Vec2 } from "../utils/pathfinding";
import { BgmControl } from "./BgmControl";
import { type BuilderAnimation, BuilderSprite } from "./BuilderSprite";
import { NestSprite } from "./NestSprite";

const ZOOM_WHEEL_STEP = 0.0015;
const CLICK_DRAG_THRESHOLD_PX = 4;
const GHOST_SIZE = 96;
const FIT_PADDING_PX = 360;

export interface MoveMarker {
  id: number;
  x: number;
  y: number;
}

interface HedgemonyMapSurfaceProps {
  nests: Nest[];
  selectedNestId: string | null;
  relocatingNestId: string | null;
  builderPath: Vec2[];
  builderPos: Vec2;
  builderPositionRef?: MutableRefObject<Vec2>;
  builderSelected: boolean;
  builderAnimation: BuilderAnimation;
  buildMode: boolean;
  moveMarker: MoveMarker | null;
  children?: ReactNode;
  overlay?: ReactNode;
  /** Left-click on empty map at world coords. */
  onMapClick?: (worldX: number, worldY: number) => void;
  /** Right-click on empty map at world coords. */
  onMapRightClick?: (worldX: number, worldY: number) => void;
  onNestSelect?: (nest: Nest) => void;
  onBuilderSelect?: () => void;
  onBuilderArrive?: () => void;
  onBuilderSegmentComplete?: (reachedIndex: number) => void;
}

export function HedgemonyMapSurface({
  nests,
  selectedNestId,
  relocatingNestId,
  builderPath,
  builderPos,
  builderPositionRef,
  builderSelected,
  builderAnimation,
  buildMode,
  moveMarker,
  children,
  overlay,
  onMapClick,
  onMapRightClick,
  onNestSelect,
  onBuilderSelect,
  onBuilderArrive,
  onBuilderSegmentComplete,
}: HedgemonyMapSurfaceProps) {
  const panX = useHedgemonyViewStore((s) => s.panX);
  const panY = useHedgemonyViewStore((s) => s.panY);
  const zoom = useHedgemonyViewStore((s) => s.zoom);
  const setPan = useHedgemonyViewStore((s) => s.setPan);
  const setZoom = useHedgemonyViewStore((s) => s.setZoom);
  const resetView = useHedgemonyViewStore((s) => s.resetView);

  const x = useMotionValue(panX);
  const y = useMotionValue(panY);
  const initial = useRef({ x: panX, y: panY });

  const outerRef = useRef<HTMLDivElement>(null);
  const pointerDown = useRef<{ x: number; y: number } | null>(null);
  const [placementPointer, setPlacementPointer] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const selectedNest =
    selectedNestId !== null
      ? (nests.find((nest) => nest.id === selectedNestId) ?? null)
      : null;
  const relocatingNest =
    relocatingNestId !== null
      ? (nests.find((nest) => nest.id === relocatingNestId) ?? null)
      : null;
  const placementMode = buildMode || relocatingNest !== null;

  const applyView = (nextPanX: number, nextPanY: number, nextZoom = zoom) => {
    x.set(nextPanX);
    y.set(nextPanY);
    setPan(nextPanX, nextPanY);
    setZoom(nextZoom);
  };

  const centerOnWorldPoint = (worldX: number, worldY: number) => {
    applyView(-worldX * zoom, -worldY * zoom);
  };

  const fitToContents = () => {
    const rect = outerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const points =
      nests.length > 0
        ? nests.map((nest) => ({ x: nest.mapX, y: nest.mapY }))
        : [{ x: builderPos.x, y: builderPos.y }];
    if (nests.length > 0) points.push({ x: builderPos.x, y: builderPos.y });

    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const contentWidth = Math.max(1, maxX - minX + FIT_PADDING_PX);
    const contentHeight = Math.max(1, maxY - minY + FIT_PADDING_PX);
    const nextZoom = Math.min(
      HEDGEMONY_ZOOM_MAX,
      Math.max(
        HEDGEMONY_ZOOM_MIN,
        Math.min(rect.width / contentWidth, rect.height / contentHeight, 1.25),
      ),
    );
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    applyView(-centerX * nextZoom, -centerY * nextZoom, nextZoom);
  };

  const centerSelected = () => {
    if (selectedNest) {
      centerOnWorldPoint(selectedNest.mapX, selectedNest.mapY);
      return;
    }
    if (builderSelected) centerOnWorldPoint(builderPos.x, builderPos.y);
  };

  const handleResetView = () => {
    x.set(0);
    y.set(0);
    resetView();
  };

  const toWorldCoords = (clientX: number, clientY: number) => {
    const rect = outerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const visibleX = clientX - rect.left - rect.width / 2;
    const visibleY = clientY - rect.top - rect.height / 2;
    return {
      x: (visibleX - x.get()) / zoom,
      y: (visibleY - y.get()) / zoom,
    };
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    setZoom(zoom * (1 - event.deltaY * ZOOM_WHEEL_STEP));
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    pointerDown.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerDown.current;
    pointerDown.current = null;
    if (event.button !== 0) return;
    if (!start || !onMapClick) return;
    if (
      (event.target as HTMLElement).closest("[data-hedgemony-nest]") &&
      !placementMode
    ) {
      return;
    }

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD_PX) return;

    const world = toWorldCoords(event.clientX, event.clientY);
    if (!world) return;
    onMapClick(world.x, world.y);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!placementMode) return;
    const world = toWorldCoords(event.clientX, event.clientY);
    if (world) setPlacementPointer(world);
  };

  const handlePointerLeave = () => {
    setPlacementPointer(null);
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (
      (event.target as HTMLElement).closest("[data-hedgemony-nest]") &&
      !placementMode
    ) {
      return;
    }
    const world = toWorldCoords(event.clientX, event.clientY);
    if (!world) return;
    onMapRightClick?.(world.x, world.y);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: map surface owns its own pointer/keyboard model
    <div
      ref={outerRef}
      className={`relative h-full w-full select-none overflow-hidden ${
        placementMode
          ? "cursor-crosshair"
          : "cursor-grab active:cursor-grabbing"
      }`}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onContextMenu={handleContextMenu}
    >
      <motion.div
        drag={!placementMode}
        dragMomentum={false}
        style={{ x, y, scale: zoom }}
        initial={{ x: initial.current.x, y: initial.current.y }}
        onDragEnd={() => setPan(x.get(), y.get())}
        className="absolute inset-0 origin-center"
      >
        <MapBackdrop />
        {nests.map((nest) => (
          <NestSprite
            key={nest.id}
            nest={nest}
            selected={nest.id === selectedNestId}
            dimmed={nest.id === relocatingNestId}
            onSelect={onNestSelect}
          />
        ))}
        <BuilderSprite
          path={builderPath}
          selected={builderSelected}
          animation={builderAnimation}
          positionRef={builderPositionRef}
          onSelect={onBuilderSelect}
          onArrive={onBuilderArrive}
          onSegmentComplete={onBuilderSegmentComplete}
        />
        {placementMode && placementPointer && (
          <div
            className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-1/2"
            style={{
              transform: `translate(calc(-50% + ${placementPointer.x}px), calc(-50% + ${placementPointer.y}px))`,
            }}
          >
            <div
              className="rounded-full border-(--accent-9) border-2 border-dashed bg-(--accent-3)/30 shadow-lg"
              style={{ width: GHOST_SIZE, height: GHOST_SIZE }}
            >
              {relocatingNest && (
                <div className="flex h-full w-full items-center justify-center px-3 text-center font-medium text-(--accent-11) text-[11px] leading-tight">
                  Move {relocatingNest.name}
                </div>
              )}
            </div>
          </div>
        )}
        <AnimatePresence>
          {moveMarker && (
            <motion.div
              key={moveMarker.id}
              className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-1/2 rounded-full border-(--accent-9) border-2"
              style={{
                left: `calc(50% + ${moveMarker.x}px)`,
                top: `calc(50% + ${moveMarker.y}px)`,
              }}
              initial={{ opacity: 0.9, width: 16, height: 16 }}
              animate={{ opacity: 0, width: 72, height: 72 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.55, ease: "easeOut" }}
            />
          )}
        </AnimatePresence>
        {children}
      </motion.div>

      {overlay && (
        <div className="pointer-events-none absolute inset-0">{overlay}</div>
      )}

      <div
        className="absolute right-3 bottom-3 flex items-center gap-2"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <BgmControl />
        <button
          type="button"
          onClick={fitToContents}
          className="flex h-7 items-center gap-1 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2) px-2 text-(--gray-11) text-[12px] transition-colors hover:bg-(--gray-3) hover:text-(--gray-12)"
          title="Fit all nests"
        >
          Fit
        </button>
        <button
          type="button"
          onClick={centerSelected}
          disabled={!selectedNest && !builderSelected}
          className="flex h-7 items-center gap-1 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2) px-2 text-(--gray-11) text-[12px] transition-colors hover:bg-(--gray-3) hover:text-(--gray-12) disabled:cursor-not-allowed disabled:opacity-50"
          title="Center selected"
        >
          Center
        </button>
        <button
          type="button"
          onClick={handleResetView}
          className="flex h-7 items-center gap-1 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2) px-2 text-(--gray-11) text-[12px] transition-colors hover:bg-(--gray-3) hover:text-(--gray-12)"
          title="Reset view"
        >
          <ArrowCounterClockwise size={12} />
          Reset
        </button>
        <div className="flex h-7 items-center rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2) px-2 text-(--gray-10) text-[12px] tabular-nums">
          {Math.round(zoom * 100)}%
        </div>
      </div>

      {buildMode && (
        <div className="-translate-x-1/2 pointer-events-none absolute top-3 left-1/2 rounded-(--radius-2) border border-(--accent-7) bg-(--accent-3) px-3 py-1 font-medium text-(--accent-11) text-[12px] shadow-sm">
          Click to place a nest · Esc / right-click to cancel
        </div>
      )}
      {relocatingNest && (
        <div className="-translate-x-1/2 pointer-events-none absolute top-3 left-1/2 rounded-(--radius-2) border border-(--accent-7) bg-(--accent-3) px-3 py-1 font-medium text-(--accent-11) text-[12px] shadow-sm">
          Click a new home for {relocatingNest.name} · Esc / right-click to
          cancel
        </div>
      )}
      {!placementMode && builderSelected && (
        <div className="-translate-x-1/2 pointer-events-none absolute top-3 left-1/2 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2) px-3 py-1 text-(--gray-11) text-[12px] shadow-sm">
          Right-click the map to move the builder
        </div>
      )}
      {!placementMode && selectedNest && (
        <div className="-translate-x-1/2 pointer-events-none absolute top-3 left-1/2 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2) px-3 py-1 text-(--gray-11) text-[12px] shadow-sm">
          Use Relocate in the panel to move this nest
        </div>
      )}
    </div>
  );
}

function MapBackdrop() {
  return (
    <div
      className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-1/2 h-[4000px] w-[4000px] overflow-hidden"
      style={{
        backgroundColor: "var(--gray-1)",
        backgroundImage: [
          // soft warm meadow wash at center
          "radial-gradient(ellipse 60% 50% at 50% 50%, var(--grass-a3) 0%, transparent 70%)",
          // scattered hedge clumps — irregular, varying sizes
          "radial-gradient(ellipse 320px 200px at 18% 22%, var(--green-a6) 0%, var(--green-a3) 45%, transparent 70%)",
          "radial-gradient(ellipse 240px 160px at 82% 28%, var(--green-a6) 0%, var(--green-a3) 45%, transparent 70%)",
          "radial-gradient(ellipse 380px 220px at 14% 78%, var(--green-a5) 0%, var(--green-a2) 50%, transparent 75%)",
          "radial-gradient(ellipse 300px 200px at 86% 80%, var(--green-a6) 0%, var(--green-a3) 45%, transparent 70%)",
          "radial-gradient(ellipse 200px 140px at 38% 12%, var(--grass-a5) 0%, transparent 65%)",
          "radial-gradient(ellipse 220px 160px at 64% 88%, var(--grass-a5) 0%, transparent 65%)",
          "radial-gradient(ellipse 180px 120px at 8% 48%, var(--green-a4) 0%, transparent 65%)",
          "radial-gradient(ellipse 200px 140px at 92% 52%, var(--green-a4) 0%, transparent 65%)",
          // subtle topographical contour rings
          "radial-gradient(circle at 50% 50%, transparent 480px, var(--gray-a3) 481px, transparent 484px)",
          "radial-gradient(circle at 50% 50%, transparent 900px, var(--gray-a2) 901px, transparent 904px)",
          "radial-gradient(circle at 50% 50%, transparent 1320px, var(--gray-a2) 1321px, transparent 1324px)",
        ].join(", "),
        backgroundRepeat: "no-repeat",
      }}
    >
      <MapZone
        x={0}
        y={0}
        width={1900}
        height={1280}
        label="Active nests"
        description="goal territory"
        variant="primary"
      />
      <MapZone
        x={-1220}
        y={860}
        width={880}
        height={520}
        label="Wilds"
        description="ad-hoc hoglets"
        variant="muted"
      />
      <MapZone
        x={1180}
        y={-820}
        width={900}
        height={540}
        label="Signal staging"
        description="unrouted signal work"
        variant="muted"
      />
    </div>
  );
}

function MapZone({
  x,
  y,
  width,
  height,
  label,
  description,
  variant,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  description: string;
  variant: "primary" | "muted";
}) {
  return (
    <div
      className={`-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 rounded-[64px] border border-dashed ${
        variant === "primary"
          ? "border-(--grass-a6) bg-(--grass-a2)"
          : "border-(--gray-a5) bg-(--gray-a1)"
      }`}
      style={{
        width,
        height,
        transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
      }}
    >
      <div className="absolute top-5 left-6 rounded-(--radius-2) border border-(--gray-a4) bg-(--gray-a2) px-2 py-1 text-(--gray-10) shadow-sm backdrop-blur-sm">
        <div className="font-medium text-(--gray-11) text-[12px] uppercase tracking-[0.16em]">
          {label}
        </div>
        <div className="mt-0.5 text-[11px]">{description}</div>
      </div>
    </div>
  );
}

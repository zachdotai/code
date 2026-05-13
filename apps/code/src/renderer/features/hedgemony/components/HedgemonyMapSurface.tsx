import type { Nest } from "@main/services/hedgemony/schemas";
import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { AnimatePresence, motion, useMotionValue } from "framer-motion";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { useHedgemonyViewStore } from "../stores/hedgemonyViewStore";
import { type BuilderAnimation, BuilderSprite } from "./BuilderSprite";
import { NestSprite } from "./NestSprite";

const ZOOM_WHEEL_STEP = 0.0015;
const CLICK_DRAG_THRESHOLD_PX = 4;
const GHOST_SIZE = 96;

export interface MoveMarker {
  id: number;
  x: number;
  y: number;
}

interface HedgemonyMapSurfaceProps {
  nests: Nest[];
  selectedNestId: string | null;
  builderX: number;
  builderY: number;
  builderSelected: boolean;
  builderAnimation: BuilderAnimation;
  builderFacing: "left" | "right";
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
}

export function HedgemonyMapSurface({
  nests,
  selectedNestId,
  builderX,
  builderY,
  builderSelected,
  builderAnimation,
  builderFacing,
  buildMode,
  moveMarker,
  children,
  overlay,
  onMapClick,
  onMapRightClick,
  onNestSelect,
  onBuilderSelect,
  onBuilderArrive,
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
  const [buildPointer, setBuildPointer] = useState<{
    x: number;
    y: number;
  } | null>(null);

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
    if ((event.target as HTMLElement).closest("[data-hedgemony-nest]")) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD_PX) return;

    const world = toWorldCoords(event.clientX, event.clientY);
    if (!world) return;
    onMapClick(world.x, world.y);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!buildMode) return;
    const world = toWorldCoords(event.clientX, event.clientY);
    if (world) setBuildPointer(world);
  };

  const handlePointerLeave = () => {
    setBuildPointer(null);
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    if ((event.target as HTMLElement).closest("[data-hedgemony-nest]")) return;
    const world = toWorldCoords(event.clientX, event.clientY);
    if (!world) return;
    onMapRightClick?.(world.x, world.y);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: map surface owns its own pointer/keyboard model
    <div
      ref={outerRef}
      className={`relative h-full w-full select-none overflow-hidden ${
        buildMode ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"
      }`}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onContextMenu={handleContextMenu}
    >
      <motion.div
        drag={!buildMode}
        dragMomentum={false}
        style={{ x, y, scale: zoom }}
        initial={{ x: initial.current.x, y: initial.current.y }}
        onDragEnd={() => setPan(x.get(), y.get())}
        className="absolute inset-0 origin-center"
      >
        <div
          className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-1/2 h-[4000px] w-[4000px]"
          style={{
            backgroundImage:
              "radial-gradient(circle, var(--gray-5) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        {nests.map((nest) => (
          <NestSprite
            key={nest.id}
            nest={nest}
            selected={nest.id === selectedNestId}
            onSelect={onNestSelect}
          />
        ))}
        <BuilderSprite
          x={builderX}
          y={builderY}
          selected={builderSelected}
          animation={builderAnimation}
          facing={builderFacing}
          onSelect={onBuilderSelect}
          onArrive={onBuilderArrive}
        />
        {buildMode && buildPointer && (
          <div
            className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-1/2"
            style={{
              transform: `translate(calc(-50% + ${buildPointer.x}px), calc(-50% + ${buildPointer.y}px))`,
            }}
          >
            <div
              className="rounded-full border-(--accent-9) border-2 border-dashed bg-(--accent-3)/30"
              style={{ width: GHOST_SIZE, height: GHOST_SIZE }}
            />
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

      <div className="absolute right-3 bottom-3 flex items-center gap-1">
        <button
          type="button"
          onClick={resetView}
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
    </div>
  );
}

import type { Nest } from "@main/services/hedgemony/schemas";
import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { motion, useMotionValue } from "framer-motion";
import type { ReactNode } from "react";
import { useRef } from "react";
import { useHedgemonyViewStore } from "../stores/hedgemonyViewStore";
import { NestSprite } from "./NestSprite";

const ZOOM_WHEEL_STEP = 0.0015;
const CLICK_DRAG_THRESHOLD_PX = 4;

interface HedgemonyMapCanvasProps {
  nests: Nest[];
  /** Rendered as a fixed overlay above the canvas (e.g. empty state). */
  overlay?: ReactNode;
  /** Called when the user clicks an empty patch of map (world coords). */
  onMapClick?: (worldX: number, worldY: number) => void;
}

export function HedgemonyMapCanvas({
  nests,
  overlay,
  onMapClick,
}: HedgemonyMapCanvasProps) {
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

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    setZoom(zoom * (1 - event.deltaY * ZOOM_WHEEL_STEP));
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    pointerDown.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerDown.current;
    pointerDown.current = null;
    if (!start || !onMapClick || !outerRef.current) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD_PX) return;

    const rect = outerRef.current.getBoundingClientRect();
    const visibleX = event.clientX - rect.left - rect.width / 2;
    const visibleY = event.clientY - rect.top - rect.height / 2;
    const worldX = (visibleX - x.get()) / zoom;
    const worldY = (visibleY - y.get()) / zoom;

    onMapClick(worldX, worldY);
  };

  return (
    <div
      ref={outerRef}
      className="relative h-full w-full cursor-grab select-none overflow-hidden active:cursor-grabbing"
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    >
      <motion.div
        drag
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
          <NestSprite key={nest.id} nest={nest} />
        ))}
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
    </div>
  );
}

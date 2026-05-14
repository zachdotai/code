import type { GridSize } from "@shared/types/work-projects";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCanvasGrid } from "./CanvasGridContext";

interface TileResizeHandleProps {
  currentSize: GridSize;
  onResize: (size: GridSize) => void;
  /** Called continuously during drag with the snapped target size, or
   *  `null` when the drag ends. The parent renders the tile at this size
   *  for live feedback without committing to the server. */
  onPreview?: (size: GridSize | null) => void;
}

/**
 * Bottom-right corner handle. Drag to resize the tile in grid cells; snaps
 * to whole cells as the cursor crosses each boundary.
 *
 * Implementation notes:
 * - Hit area is intentionally larger (20×20) than the visible glyph (12×12)
 *   so the user doesn't have to be pixel-precise on the corner.
 * - The handle is hover-visible by default and stays visible while dragging
 *   (so users can re-grip without re-hovering precisely).
 * - Listeners are removed on `mouseup` AND on unmount (e.g. tile removed
 *   mid-drag) so no global handler can leak.
 */
export function TileResizeHandle({
  currentSize,
  onResize,
  onPreview,
}: TileResizeHandleProps) {
  const grid = useCanvasGrid();
  const [dragging, setDragging] = useState(false);
  const startRef = useRef<{
    x: number;
    y: number;
    cols: number;
    rows: number;
    metrics: { cellWidth: number; cellHeight: number; gap: number };
  } | null>(null);
  const lastEmittedRef = useRef<GridSize>(currentSize);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      const start = startRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const cellStrideX = start.metrics.cellWidth + start.metrics.gap;
      const cellStrideY = start.metrics.cellHeight + start.metrics.gap;
      // Use floor + a 0.4 cell threshold for snappier feel — the next cell
      // commits when the cursor crosses ~40% of the way to it, not 50%. This
      // matches expectations: users perceive "snap" as the moment the size
      // changes feel inevitable, not when the math is exactly halfway.
      const deltaCols = Math.floor((dx + cellStrideX * 0.4) / cellStrideX);
      const deltaRows = Math.floor((dy + cellStrideY * 0.4) / cellStrideY);
      const nextCols = Math.max(1, Math.min(12, start.cols + deltaCols));
      const nextRows = Math.max(1, Math.min(4, start.rows + deltaRows));
      const next = { cols: nextCols, rows: nextRows };
      if (
        next.cols !== lastEmittedRef.current.cols ||
        next.rows !== lastEmittedRef.current.rows
      ) {
        lastEmittedRef.current = next;
        onPreview?.(next);
      }
    },
    [onPreview],
  );

  const handleMouseUp = useCallback(() => {
    const last = lastEmittedRef.current;
    onPreview?.(null);
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    startRef.current = null;
    setDragging(false);
    if (last.cols !== currentSize.cols || last.rows !== currentSize.rows) {
      onResize(last);
    }
  }, [currentSize, handleMouseMove, onPreview, onResize]);

  useEffect(
    () => () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    },
    [handleMouseMove, handleMouseUp],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!grid) return;
      const metrics = grid.measure();
      if (!metrics) return;
      e.preventDefault();
      e.stopPropagation();
      startRef.current = {
        x: e.clientX,
        y: e.clientY,
        cols: currentSize.cols,
        rows: currentSize.rows,
        metrics,
      };
      lastEmittedRef.current = currentSize;
      setDragging(true);
      document.body.style.cursor = "nwse-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [grid, currentSize, handleMouseMove, handleMouseUp],
  );

  return (
    <button
      type="button"
      aria-label="Resize tile"
      onMouseDown={handleMouseDown}
      title="Drag to resize"
      className={`absolute right-0 bottom-0 z-10 flex h-5 w-5 cursor-nwse-resize items-end justify-end p-0.5 text-(--gray-9) transition-opacity duration-100 hover:text-(--accent-9) group-hover/tile:opacity-100 ${
        dragging ? "text-(--accent-9) opacity-100" : "opacity-0"
      }`}
    >
      <svg
        viewBox="0 0 12 12"
        className="h-3 w-3"
        role="presentation"
        aria-hidden="true"
      >
        <title>Resize</title>
        <path
          d="M 11 4 L 4 11 M 11 8 L 8 11"
          stroke="currentColor"
          strokeWidth={1.5}
          fill="none"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

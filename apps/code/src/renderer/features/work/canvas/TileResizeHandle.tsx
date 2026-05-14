import type { GridSize } from "@shared/types/work-projects";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCanvasGrid } from "./CanvasGridContext";

interface TileResizeHandleProps {
  currentSize: GridSize;
  onResize: (size: GridSize) => void;
  /** Called continuously during drag for live preview. */
  onPreview?: (size: GridSize | null) => void;
}

/** Bottom-right corner handle. Drag to resize the tile in grid cells.
 *  Snaps live as the cursor crosses cell boundaries. */
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
      const deltaCols = Math.round(dx / cellStrideX);
      const deltaRows = Math.round(dy / cellStrideY);
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

  // Always clean up listeners on unmount so a tile removed mid-drag doesn't
  // leak a global mouse handler.
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
      className={`-bottom-px -right-px absolute z-10 h-3.5 w-3.5 cursor-nwse-resize rounded-tl-[3px] bg-transparent text-(--gray-9) opacity-0 transition-opacity duration-100 hover:text-(--gray-12) group-hover/tile:opacity-100 ${
        dragging ? "!opacity-100" : ""
      }`}
      title="Drag to resize"
    >
      <svg
        viewBox="0 0 12 12"
        className="h-full w-full"
        role="presentation"
        aria-hidden="true"
      >
        <title>Resize</title>
        <path
          d="M 1 11 L 11 1 M 5 11 L 11 5 M 9 11 L 11 9"
          stroke="currentColor"
          strokeWidth={1.25}
          fill="none"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

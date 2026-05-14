import type { GridSize, Tile, TileSize } from "@shared/types/work-projects";

/** Legacy size-enum → gridSize mapping. Used when a tile predates the
 *  gridSize field. Title tiles always live as full-width. */
const LEGACY_SIZE_TO_GRID: Record<TileSize, GridSize> = {
  sm: { cols: 3, rows: 1 },
  md: { cols: 6, rows: 2 },
  lg: { cols: 8, rows: 2 },
  full: { cols: 12, rows: 2 },
};

/** Read the gridSize for a tile. Falls back to the legacy `size` enum
 *  when the new field is absent. */
export function resolveGridSize(tile: Tile): GridSize {
  if (tile.gridSize) return tile.gridSize;
  return LEGACY_SIZE_TO_GRID[tile.size];
}

/** Snap a gridSize to one of the named buckets, used by the quick-pick
 *  menu so we still surface canonical sizes. */
export function gridSizeFromTileSize(size: TileSize): GridSize {
  return LEGACY_SIZE_TO_GRID[size];
}

/** Tailwind class for col-span by integer. We can't interpolate Tailwind
 *  arbitrary values reliably across builds, so we map explicitly. */
export const COL_SPAN_CLASS: Record<number, string> = {
  1: "col-span-1",
  2: "col-span-2",
  3: "col-span-3",
  4: "col-span-4",
  5: "col-span-5",
  6: "col-span-6",
  7: "col-span-7",
  8: "col-span-8",
  9: "col-span-9",
  10: "col-span-10",
  11: "col-span-11",
  12: "col-span-12",
};

export const ROW_SPAN_CLASS: Record<number, string> = {
  1: "row-span-1",
  2: "row-span-2",
  3: "row-span-3",
  4: "row-span-4",
};

export function spanClasses(gridSize: GridSize): string {
  return `${COL_SPAN_CLASS[gridSize.cols] ?? "col-span-6"} ${ROW_SPAN_CLASS[gridSize.rows] ?? "row-span-1"}`;
}

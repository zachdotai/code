import type { GridSize, Tile } from "@shared/types/work-projects";
import { resolveGridSize } from "./grid-utils";

/** A single row of the 12-col grid as a width-12 occupancy bitmask. */
type RowMask = number;

/** Mark `cols` cells starting at `x` on `mask`. */
function fill(mask: RowMask, x: number, cols: number): RowMask {
  let m = mask;
  for (let i = 0; i < cols; i++) m |= 1 << (x + i);
  return m;
}

/** Is the span starting at `x` of `cols` cells free on `mask`? */
function fits(mask: RowMask, x: number, cols: number): boolean {
  for (let i = 0; i < cols; i++) {
    if (mask & (1 << (x + i))) return false;
  }
  return true;
}

interface RglItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Convert an ordered list of tiles to RGL layout items. Tiles with a saved
 * `gridPosition` use it verbatim. Tiles without one are packed left-to-right,
 * top-to-bottom into the next free slot. Compatible with the canvas's existing
 * "row dense" feel.
 */
export function packTilesToLayout(tiles: Tile[]): RglItem[] {
  // Track per-row occupancy bitmasks. Grows lazily.
  const rows: RowMask[] = [];
  const ensureRow = (y: number): void => {
    while (rows.length <= y) rows.push(0);
  };

  const items: RglItem[] = [];

  // First pass: place tiles that already have a saved position, marking their
  // cells occupied so the auto-placer skips around them.
  for (const t of tiles) {
    if (!t.gridPosition) continue;
    const size: GridSize = resolveGridSize(t);
    const { x, y } = t.gridPosition;
    const cols = Math.max(1, Math.min(12, size.cols));
    const rowsCount = Math.max(1, Math.min(4, size.rows));
    const clampedX = Math.max(0, Math.min(12 - cols, x));
    const clampedY = Math.max(0, y);
    for (let r = 0; r < rowsCount; r++) {
      ensureRow(clampedY + r);
      rows[clampedY + r] = fill(rows[clampedY + r], clampedX, cols);
    }
    items.push({
      i: t.id,
      x: clampedX,
      y: clampedY,
      w: cols,
      h: rowsCount,
    });
  }

  // Second pass: auto-place tiles without a saved position into the first
  // free slot. Uses `tiles`'s order to make placement stable.
  for (const t of tiles) {
    if (t.gridPosition) continue;
    const size: GridSize = resolveGridSize(t);
    const cols = Math.max(1, Math.min(12, size.cols));
    const rowsCount = Math.max(1, Math.min(4, size.rows));
    let placedAt: { x: number; y: number } | null = null;
    for (let y = 0; placedAt === null; y++) {
      ensureRow(y + rowsCount - 1);
      for (let x = 0; x <= 12 - cols; x++) {
        let ok = true;
        for (let r = 0; r < rowsCount; r++) {
          if (!fits(rows[y + r], x, cols)) {
            ok = false;
            break;
          }
        }
        if (ok) {
          placedAt = { x, y };
          break;
        }
      }
      if (y > 256) break; // safety net, should never trip
    }
    if (!placedAt) placedAt = { x: 0, y: rows.length };
    for (let r = 0; r < rowsCount; r++) {
      ensureRow(placedAt.y + r);
      rows[placedAt.y + r] = fill(rows[placedAt.y + r], placedAt.x, cols);
    }
    items.push({
      i: t.id,
      x: placedAt.x,
      y: placedAt.y,
      w: cols,
      h: rowsCount,
    });
  }

  return items;
}

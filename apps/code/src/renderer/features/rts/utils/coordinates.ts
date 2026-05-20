import type { Vec2 } from "./pathfinding";

/**
 * Convert client (viewport) pixel coords to world coords for the Rts
 * pan/zoom surface. The surface's origin is the center of its bounding rect;
 * pan offsets the world; zoom scales it.
 */
export function clientToWorld(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  panX: number,
  panY: number,
  zoom: number,
): Vec2 {
  return {
    x: (clientX - rect.left - rect.width / 2 - panX) / zoom,
    y: (clientY - rect.top - rect.height / 2 - panY) / zoom,
  };
}

/**
 * Pan values that place the given world point at the surface center.
 */
export function panToCenter(
  worldX: number,
  worldY: number,
  zoom: number,
): Vec2 {
  return { x: -worldX * zoom, y: -worldY * zoom };
}

/**
 * Compute the zoom that fits a bounding box inside a viewport with padding,
 * clamped to [min, max] and capped at a maximum scale (so a tiny world doesn't
 * blow up to 5x).
 */
export function fitZoom(
  contentWidth: number,
  contentHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  minZoom: number,
  maxZoom: number,
  cap = 1.25,
): number {
  const fit = Math.min(
    viewportWidth / Math.max(1, contentWidth),
    viewportHeight / Math.max(1, contentHeight),
    cap,
  );
  return Math.min(maxZoom, Math.max(minZoom, fit));
}

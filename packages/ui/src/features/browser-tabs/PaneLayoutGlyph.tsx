import type { PaneLayoutNode } from "@posthog/shared";

const SIZE = 14;
const GAP = 1.5;

type GlyphRect = { x: number; y: number; w: number; h: number };

/** Flatten the layout tree into proportional rects within a SIZE×SIZE box. */
function collectRects(
  node: PaneLayoutNode,
  x: number,
  y: number,
  w: number,
  h: number,
  out: GlyphRect[],
): void {
  if (node.type === "leaf") {
    out.push({ x, y, w, h });
    return;
  }
  const n = node.children.length;
  const total = (node.direction === "row" ? w : h) - GAP * (n - 1);
  const sum = node.sizes.reduce((a, b) => a + b, 0) || 1;
  let offset = node.direction === "row" ? x : y;
  node.children.forEach((child, i) => {
    const share = total * ((node.sizes[i] ?? 1 / n) / sum);
    if (node.direction === "row") {
      collectRects(child, offset, y, share, h, out);
    } else {
      collectRects(child, x, offset, w, share, out);
    }
    offset += share + GAP;
  });
}

/**
 * Mini-diagram of a tab's ACTUAL pane configuration, drawn on the pill of a
 * multi-pane tab (visual language borrowed from the command-center layout
 * picker's `LayoutIcon`, but rendering the real tree — proportions included —
 * rather than preset grids).
 */
export function PaneLayoutGlyph({ layout }: { layout: PaneLayoutNode }) {
  const rects: GlyphRect[] = [];
  collectRects(layout, 0, 0, SIZE, SIZE, rects);
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      aria-hidden="true"
    >
      {rects.map((r) => (
        <rect
          key={`${r.x}-${r.y}`}
          x={r.x}
          y={r.y}
          width={Math.max(r.w, 1)}
          height={Math.max(r.h, 1)}
          rx={1}
          fill="currentColor"
          opacity={0.5}
        />
      ))}
    </svg>
  );
}

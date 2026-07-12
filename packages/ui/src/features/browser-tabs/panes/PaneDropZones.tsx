import { useDroppable } from "@dnd-kit/react";
import type { SplitDropDirection } from "@posthog/shared";
import type { CSSProperties } from "react";
import { usePaneDragStore } from "./paneDragStore";

type PaneZone = SplitDropDirection | "center";

/** Hit-zone geometry: four 20% edge strips + the middle (PanelDropZones'
 * proven layout). */
const ZONE_SIZE = "20%";
const HIT_STYLES: Record<PaneZone, CSSProperties> = {
  top: { top: 0, left: 0, right: 0, height: ZONE_SIZE },
  bottom: { bottom: 0, left: 0, right: 0, height: ZONE_SIZE },
  left: { top: 0, left: 0, bottom: 0, width: ZONE_SIZE },
  right: { top: 0, right: 0, bottom: 0, width: ZONE_SIZE },
  center: {
    top: ZONE_SIZE,
    left: ZONE_SIZE,
    right: ZONE_SIZE,
    bottom: ZONE_SIZE,
  },
};

/** Preview geometry: the RESULTING pane (VS Code style) — half the pane on an
 * edge drop, the whole pane on a center (merge-here) drop. */
const PREVIEW_CLASSES: Record<PaneZone, string> = {
  left: "inset-y-0 left-0 w-1/2",
  right: "inset-y-0 right-0 w-1/2",
  top: "inset-x-0 top-0 h-1/2",
  bottom: "inset-x-0 bottom-0 h-1/2",
  center: "inset-0",
};

function Zone({ paneId, zone }: { paneId: string; zone: PaneZone }) {
  const { ref, isDropTarget } = useDroppable({
    id: `browser-pane-zone-${paneId}-${zone}`,
    data: { type: "browser-pane-zone", paneId, zone },
  });
  return (
    <>
      {/* Invisible hit strip. */}
      <div
        ref={ref}
        className="pointer-events-auto absolute"
        style={HIT_STYLES[zone]}
      />
      {/* Translucent preview of the resulting pane, shown while hovered. */}
      {isDropTarget ? (
        <div
          className={`pointer-events-none absolute rounded-sm bg-accent/15 ring-1 ring-accent/40 ring-inset transition-all duration-150 ${PREVIEW_CLASSES[zone]}`}
        />
      ) : null}
    </>
  );
}

/**
 * Merge drop zones overlaying one pane's content, mounted only while a
 * browser-tab pill drag is live. Dropping tab B on a zone merges B INTO the
 * active tab as a split next to this pane (edges pick the side; center merges
 * to the right of this pane) — B's pill disappears and the active tab gains
 * its panes. Dragging the ACTIVE tab's own pill mounts no zones (a tab can't
 * merge into itself) — enforced by the caller (PaneChrome checks the drag
 * against the active tab).
 */
export function PaneDropZones({ paneId }: { paneId: string }) {
  const drag = usePaneDragStore((s) => s.drag);
  if (!drag) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[100]">
      {(["center", "left", "right", "top", "bottom"] as const).map((zone) => (
        <Zone key={zone} paneId={paneId} zone={zone} />
      ))}
    </div>
  );
}

import { useDroppable } from "@dnd-kit/react";
import type { SplitDropDirection } from "@posthog/shared";
import type { CSSProperties } from "react";
import { readMirror } from "../tabsSync";
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
 * edge drop, the whole pane on a center (move-into) drop. */
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
 * Split/move drop zones overlaying one pane's content, mounted only while a
 * browser-tab pill drag is live. Edge zones split the pane; the center zone
 * moves the tab into it. Gating:
 * - the source pane's center zone is suppressed (dropping a tab on its own
 *   pane is a no-op — don't tease it);
 * - the source pane's edge zones need a second tab (splitting out a pane's
 *   only tab just recreates the current layout).
 */
export function PaneDropZones({ paneId }: { paneId: string }) {
  const drag = usePaneDragStore((s) => s.drag);
  if (!drag) return null;
  const isSource = drag.sourcePaneId === paneId;
  // Read once per drag mount — the pane composition can't change mid-drag
  // from this window (the drag IS the interaction).
  const sourceHasSiblings =
    readMirror().tabs.filter((t) => t.paneId === drag.sourcePaneId).length > 1;
  const zones: PaneZone[] = [];
  if (!isSource) zones.push("center");
  if (!isSource || sourceHasSiblings) {
    zones.push("left", "right", "top", "bottom");
  }
  if (zones.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[100]">
      {zones.map((zone) => (
        <Zone key={zone} paneId={paneId} zone={zone} />
      ))}
    </div>
  );
}

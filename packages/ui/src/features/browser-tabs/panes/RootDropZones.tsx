import { CollisionPriority } from "@dnd-kit/abstract";
import { useDroppable } from "@dnd-kit/react";
import type { SplitDropDirection } from "@posthog/shared";
import type { CSSProperties } from "react";
import { usePaneDragStore } from "./paneDragStore";

/** Thin edge strips over the WHOLE content area for merging at the active
 * tab's layout root. High collision priority so they beat the outermost
 * panes' 20% edge zones where the two overlap. */
const EDGE = "18px";
const HIT_STYLES: Record<SplitDropDirection, CSSProperties> = {
  top: { top: 0, left: 0, right: 0, height: EDGE },
  bottom: { bottom: 0, left: 0, right: 0, height: EDGE },
  left: { top: 0, left: 0, bottom: 0, width: EDGE },
  right: { top: 0, right: 0, bottom: 0, width: EDGE },
};

const PREVIEW_CLASSES: Record<SplitDropDirection, string> = {
  left: "inset-y-0 left-0 w-1/2",
  right: "inset-y-0 right-0 w-1/2",
  top: "inset-x-0 top-0 h-1/2",
  bottom: "inset-x-0 bottom-0 h-1/2",
};

function RootZone({ zone }: { zone: SplitDropDirection }) {
  const { ref, isDropTarget } = useDroppable({
    id: `browser-root-zone-${zone}`,
    data: { type: "browser-root-zone", zone },
    collisionPriority: CollisionPriority.High,
  });
  return (
    <>
      <div
        ref={ref}
        className="pointer-events-auto absolute"
        style={HIT_STYLES[zone]}
      />
      {isDropTarget ? (
        <div
          className={`pointer-events-none absolute rounded-sm bg-accent/15 ring-1 ring-accent/40 ring-inset transition-all duration-150 ${PREVIEW_CLASSES[zone]}`}
        />
      ) : null}
    </>
  );
}

/**
 * Content-area edge drops that merge the dragged tab at the active tab's
 * layout ROOT (the whole content area splits; nav and title bar stay put).
 * Mounted only while a pill drag is live, and suppressed when the dragged
 * pill is the active tab's own (a tab can't merge into itself).
 */
export function RootDropZones({ enabled }: { enabled: boolean }) {
  const drag = usePaneDragStore((s) => s.drag);
  if (!drag || !enabled) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[110]">
      {(["left", "right", "top", "bottom"] as const).map((zone) => (
        <RootZone key={zone} zone={zone} />
      ))}
    </div>
  );
}

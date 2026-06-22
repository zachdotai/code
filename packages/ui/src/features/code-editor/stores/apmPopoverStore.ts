import type { ApmLineMarker } from "@posthog/core/code-editor/buildApmLineMarkers";
import { create } from "zustand";
import type { PopoverAnchorRect } from "./enrichmentPopoverStore";

interface ApmPopoverMeta {
  /** File the stats belong to; the popover shows its basename in the footer. */
  filePath: string | null;
  /** Deep link to the PostHog tracing explorer for "View in PostHog". */
  tracingUrl: string | null;
}

interface ApmPopoverState extends ApmPopoverMeta {
  open: boolean;
  anchorRect: PopoverAnchorRect | null;
  marker: ApmLineMarker | null;
  show: (
    rect: PopoverAnchorRect,
    marker: ApmLineMarker,
    meta: ApmPopoverMeta,
  ) => void;
  close: () => void;
}

export const useApmPopoverStore = create<ApmPopoverState>((set) => ({
  open: false,
  anchorRect: null,
  marker: null,
  filePath: null,
  tracingUrl: null,
  show: (rect, marker, meta) =>
    set({
      open: true,
      anchorRect: rect,
      marker,
      filePath: meta.filePath,
      tracingUrl: meta.tracingUrl,
    }),
  close: () =>
    set({
      open: false,
      marker: null,
      anchorRect: null,
      filePath: null,
      tracingUrl: null,
    }),
}));

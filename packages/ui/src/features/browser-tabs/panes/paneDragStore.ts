import { create } from "zustand";

/**
 * Transient view state for a live browser-tab pill drag (pattern:
 * tabReorderStore). While set, the active tab's panes mount their merge drop
 * zones and the root edge zones mount over the content area. Never in the
 * snapshot mirror — a server push mid-drag must not clobber it, and the shell
 * must not re-render per dragover.
 */
interface PaneDragState {
  drag: { tabId: string } | null;
  setDrag: (drag: { tabId: string } | null) => void;
}

export const usePaneDragStore = create<PaneDragState>((set) => ({
  drag: null,
  setDrag: (drag) => set({ drag }),
}));

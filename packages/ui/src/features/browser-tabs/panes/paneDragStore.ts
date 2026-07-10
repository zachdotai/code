import { create } from "zustand";

/**
 * Transient view state for a live browser-tab pill drag (pattern:
 * tabReorderStore). While set, every pane mounts its drop zones and the root
 * edge zones mount over the content area. Never in the snapshot mirror — a
 * server push mid-drag must not clobber it, and the shell must not re-render
 * per dragover.
 */
interface PaneDragState {
  drag: { tabId: string; sourcePaneId: string } | null;
  setDrag: (drag: { tabId: string; sourcePaneId: string } | null) => void;
}

export const usePaneDragStore = create<PaneDragState>((set) => ({
  drag: null,
  setDrag: (drag) => set({ drag }),
}));

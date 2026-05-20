import { create } from "zustand";

/**
 * Mirrors the currently selected hoglet IDs out of HedgemonyMapView's local
 * `Selection` state so consumers outside the map (e.g. the sidebar task list)
 * can react to selection without lifting the whole selection union into a
 * shared store. The map clears this on unmount.
 */
interface HedgemonySelectionState {
  selectedHogletIds: string[];
}

interface HedgemonySelectionActions {
  setSelectedHogletIds: (ids: string[]) => void;
  clear: () => void;
}

type HedgemonySelectionStore = HedgemonySelectionState &
  HedgemonySelectionActions;

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export const useHedgemonySelectionStore = create<HedgemonySelectionStore>()(
  (set) => ({
    selectedHogletIds: [],
    setSelectedHogletIds: (ids) =>
      set((state) =>
        sameIds(state.selectedHogletIds, ids)
          ? state
          : { selectedHogletIds: ids },
      ),
    clear: () =>
      set((state) =>
        state.selectedHogletIds.length === 0
          ? state
          : { selectedHogletIds: [] },
      ),
  }),
);

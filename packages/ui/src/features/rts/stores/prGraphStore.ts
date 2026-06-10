import type { PrDependencyView } from "@posthog/host-router/rts-schemas";
import { create } from "zustand";

interface PrGraphStoreState {
  edgesByNest: Record<string, PrDependencyView[]>;
  loaded: Record<string, boolean>;
}

interface PrGraphStoreActions {
  setForNest: (nestId: string, edges: PrDependencyView[]) => void;
  upsert: (nestId: string, edge: PrDependencyView) => void;
  remove: (nestId: string, edgeId: string) => void;
  reset: () => void;
}

type PrGraphStore = PrGraphStoreState & PrGraphStoreActions;

const initialState: PrGraphStoreState = {
  edgesByNest: {},
  loaded: {},
};

export const usePrGraphStore = create<PrGraphStore>()((set) => ({
  ...initialState,

  setForNest: (nestId, edges) =>
    set((state) => ({
      edgesByNest: { ...state.edgesByNest, [nestId]: edges },
      loaded: { ...state.loaded, [nestId]: true },
    })),

  upsert: (nestId, edge) =>
    set((state) => {
      const current = state.edgesByNest[nestId] ?? [];
      const without = current.filter((e) => e.id !== edge.id);
      return {
        edgesByNest: {
          ...state.edgesByNest,
          [nestId]: [...without, edge],
        },
      };
    }),

  remove: (nestId, edgeId) =>
    set((state) => {
      const current = state.edgesByNest[nestId];
      if (!current) return state;
      return {
        edgesByNest: {
          ...state.edgesByNest,
          [nestId]: current.filter((e) => e.id !== edgeId),
        },
      };
    }),

  reset: () => set(initialState),
}));

export const selectEdgesForNest =
  (nestId: string) =>
  (state: PrGraphStore): PrDependencyView[] =>
    state.edgesByNest[nestId] ?? [];

export const selectEdgesLoadedForNest =
  (nestId: string) =>
  (state: PrGraphStore): boolean =>
    state.loaded[nestId] ?? false;

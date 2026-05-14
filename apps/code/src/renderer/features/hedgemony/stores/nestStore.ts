import type { HedgehogStateView, Nest } from "@main/services/hedgemony/schemas";
import { create } from "zustand";

interface NestStoreState {
  nests: Record<string, Nest>;
  /**
   * Latest hedgehog tick state per nest, mirrored from `hedgehog_tick`
   * events on the nest watch channel. Drives the "ticking" sprite glow.
   * Not persisted — recomputed on app boot.
   */
  hedgehogStateByNestId: Record<string, HedgehogStateView>;
  loaded: boolean;
}

interface NestStoreActions {
  setAll: (nests: Nest[]) => void;
  upsert: (nest: Nest) => void;
  remove: (id: string) => void;
  setHedgehogState: (nestId: string, state: HedgehogStateView) => void;
}

type NestStore = NestStoreState & NestStoreActions;

export const useNestStore = create<NestStore>()((set) => ({
  nests: {},
  hedgehogStateByNestId: {},
  loaded: false,

  setAll: (nests) =>
    set({
      nests: Object.fromEntries(nests.map((n) => [n.id, n])),
      loaded: true,
    }),

  upsert: (nest) =>
    set((state) => ({
      nests: { ...state.nests, [nest.id]: nest },
    })),

  remove: (id) =>
    set((state) => {
      const next = { ...state.nests };
      delete next[id];
      const nextHedgehog = { ...state.hedgehogStateByNestId };
      delete nextHedgehog[id];
      return { nests: next, hedgehogStateByNestId: nextHedgehog };
    }),

  setHedgehogState: (nestId, hedgehogState) =>
    set((state) => ({
      hedgehogStateByNestId: {
        ...state.hedgehogStateByNestId,
        [nestId]: hedgehogState,
      },
    })),
}));

// Cache by `state.nests` reference. Hedgehog ticks replace
// `hedgehogStateByNestId` but leave `state.nests` untouched, so this returns a
// stable array for every consumer between actual nest CRUD events — avoiding a
// cascade of re-renders (and PR-graph subscription churn in HedgemonyMapView)
// on every 30s tick.
let cachedNestsInput: Record<string, Nest> | null = null;
let cachedNestsOutput: Nest[] = [];

export const selectNests = (state: NestStore): Nest[] => {
  if (state.nests === cachedNestsInput) return cachedNestsOutput;
  cachedNestsInput = state.nests;
  cachedNestsOutput = Object.values(state.nests).filter(
    (n) => n.status !== "archived",
  );
  return cachedNestsOutput;
};

export const selectHedgehogState =
  (nestId: string | null) =>
  (state: NestStore): HedgehogStateView | null =>
    nestId ? (state.hedgehogStateByNestId[nestId] ?? null) : null;

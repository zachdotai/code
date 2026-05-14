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

export const selectNests = (state: NestStore): Nest[] =>
  Object.values(state.nests).filter((n) => n.status !== "archived");

export const selectHedgehogState =
  (nestId: string | null) =>
  (state: NestStore): HedgehogStateView | null =>
    nestId ? (state.hedgehogStateByNestId[nestId] ?? null) : null;

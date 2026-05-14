import type { Nest } from "@main/services/hedgemony/schemas";
import { create } from "zustand";

interface NestStoreState {
  nests: Record<string, Nest>;
  loaded: boolean;
}

interface NestStoreActions {
  setAll: (nests: Nest[]) => void;
  upsert: (nest: Nest) => void;
  remove: (id: string) => void;
}

type NestStore = NestStoreState & NestStoreActions;

export const useNestStore = create<NestStore>()((set) => ({
  nests: {},
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
      return { nests: next };
    }),
}));

export const selectNests = (state: NestStore): Nest[] =>
  Object.values(state.nests).filter((n) => n.status !== "archived");

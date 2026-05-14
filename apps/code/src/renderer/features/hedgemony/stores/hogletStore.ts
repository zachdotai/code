import type { Hoglet } from "@main/services/hedgemony/schemas";
import type { Schemas } from "@renderer/api/generated";
import { create } from "zustand";

export const WILD_BUCKET = "wild";

export interface DyingHogletEntry {
  hogletId: string;
  x: number;
  y: number;
}

interface HogletStoreState {
  byBucket: Record<string, Hoglet[]>;
  taskSummaries: Record<string, Schemas.TaskSummary>;
  loaded: Record<string, boolean>;
  dying: Map<string, DyingHogletEntry>;
}

interface HogletStoreActions {
  setBucket: (bucket: string, hoglets: Hoglet[]) => void;
  upsert: (bucket: string, hoglet: Hoglet) => void;
  remove: (bucket: string, hogletId: string) => void;
  startDying: (hogletId: string, x: number, y: number) => void;
  finalizeDeath: (hogletId: string) => void;
  setTaskSummaries: (summaries: Schemas.TaskSummary[]) => void;
  reset: () => void;
}

type HogletStore = HogletStoreState & HogletStoreActions;

const initialState: HogletStoreState = {
  byBucket: {},
  taskSummaries: {},
  loaded: {},
  dying: new Map(),
};

export const useHogletStore = create<HogletStore>()((set) => ({
  ...initialState,

  setBucket: (bucket, hoglets) =>
    set((state) => ({
      byBucket: { ...state.byBucket, [bucket]: hoglets },
      loaded: { ...state.loaded, [bucket]: true },
    })),

  upsert: (bucket, hoglet) =>
    set((state) => {
      const current = state.byBucket[bucket] ?? [];
      const without = current.filter((h) => h.id !== hoglet.id);
      return {
        byBucket: { ...state.byBucket, [bucket]: [...without, hoglet] },
      };
    }),

  remove: (bucket, hogletId) =>
    set((state) => {
      const current = state.byBucket[bucket];
      if (!current) return state;
      return {
        byBucket: {
          ...state.byBucket,
          [bucket]: current.filter((h) => h.id !== hogletId),
        },
      };
    }),

  startDying: (hogletId, x, y) =>
    set((state) => {
      const next = new Map(state.dying);
      next.set(hogletId, { hogletId, x, y });
      return { dying: next };
    }),

  finalizeDeath: (hogletId) =>
    set((state) => {
      const next = new Map(state.dying);
      next.delete(hogletId);
      return { dying: next };
    }),

  setTaskSummaries: (summaries) =>
    set((state) => {
      const next = { ...state.taskSummaries };
      for (const s of summaries) next[s.id] = s;
      return { taskSummaries: next };
    }),

  reset: () => set(initialState),
}));

export const selectWildHoglets = (state: HogletStore): Hoglet[] =>
  state.byBucket[WILD_BUCKET] ?? [];

export const selectWildLoaded = (state: HogletStore): boolean =>
  state.loaded[WILD_BUCKET] ?? false;

export const selectNestHoglets =
  (nestId: string) =>
  (state: HogletStore): Hoglet[] =>
    state.byBucket[nestId] ?? [];

export const selectNestHogletsLoaded =
  (nestId: string) =>
  (state: HogletStore): boolean =>
    state.loaded[nestId] ?? false;

export const selectTaskSummary =
  (taskId: string) =>
  (state: HogletStore): Schemas.TaskSummary | null =>
    state.taskSummaries[taskId] ?? null;

export const selectHogletById =
  (hogletId: string | null) =>
  (state: HogletStore): Hoglet | null => {
    if (!hogletId) return null;
    for (const bucket of Object.values(state.byBucket)) {
      const match = bucket.find((h) => h.id === hogletId);
      if (match) return match;
    }
    return null;
  };

export const selectDyingHoglets = (state: HogletStore): DyingHogletEntry[] => [
  ...state.dying.values(),
];

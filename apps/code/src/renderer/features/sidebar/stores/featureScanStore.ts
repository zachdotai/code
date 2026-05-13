import { create } from "zustand";

export type FeatureScanState = "scanning" | "done" | "failed";

interface FeatureScanStoreState {
  state: Record<string, FeatureScanState>;
}

interface FeatureScanStoreActions {
  setState: (repositoryId: string, state: FeatureScanState) => void;
  reset: (repositoryId: string) => void;
}

type FeatureScanStore = FeatureScanStoreState & FeatureScanStoreActions;

export const useFeatureScanStore = create<FeatureScanStore>()((set) => ({
  state: {},
  setState: (repositoryId, state) =>
    set((prev) => ({ state: { ...prev.state, [repositoryId]: state } })),
  reset: (repositoryId) =>
    set((prev) => {
      const next = { ...prev.state };
      delete next[repositoryId];
      return { state: next };
    }),
}));

import { create } from "zustand";
import { persist } from "zustand/middleware";

// Backstop: tasks deleted without archiving would otherwise accumulate forever.
// Cap by file count (not task count) since files-per-task varies; evict
// least-recently-touched tasks past the cap.
const MAX_FILES = 250;

interface ReviewViewedStoreState {
  viewed: Record<string, Record<string, string>>;
}

interface ReviewViewedStoreActions {
  setViewed: (taskId: string, key: string, sig: string | null) => void;
  clearTasks: (taskIds: Iterable<string>) => void;
}

type ReviewViewedStore = ReviewViewedStoreState & ReviewViewedStoreActions;

export const useReviewViewedStore = create<ReviewViewedStore>()(
  persist(
    (set) => ({
      viewed: {},
      setViewed: (taskId, key, sig) =>
        set((state) => {
          const taskViewed = { ...(state.viewed[taskId] ?? {}) };
          if (sig === null) delete taskViewed[key];
          else taskViewed[key] = sig;

          const { [taskId]: _omit, ...rest } = state.viewed;
          const next =
            Object.keys(taskViewed).length > 0
              ? { ...rest, [taskId]: taskViewed }
              : rest;

          let total = 0;
          for (const id in next) total += Object.keys(next[id]).length;
          for (const id of Object.keys(next)) {
            if (total <= MAX_FILES) break;
            if (id === taskId) continue;
            total -= Object.keys(next[id]).length;
            delete next[id];
          }
          return { viewed: next };
        }),
      clearTasks: (taskIds) =>
        set((state) => {
          let changed = false;
          const next = { ...state.viewed };
          for (const id of taskIds) {
            if (id in next) {
              delete next[id];
              changed = true;
            }
          }
          return changed ? { viewed: next } : state;
        }),
    }),
    {
      name: "review-viewed-storage",
      version: 1,
      migrate: (persisted, version) => {
        if (version < 1) return { viewed: {} };
        return persisted as ReviewViewedStoreState;
      },
    },
  ),
);

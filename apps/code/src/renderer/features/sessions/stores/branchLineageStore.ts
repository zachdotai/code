/**
 * Tracks branch lineage client-side (keyed by child task id) until the
 * `Task` model persists it. See `BranchLineage` in shared types.
 */
import type { BranchLineage } from "@shared/types";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface BranchLineageStoreState {
  lineageByTaskId: Record<string, BranchLineage>;
}

interface BranchLineageStoreActions {
  setLineage: (taskId: string, lineage: BranchLineage) => void;
  getLineage: (taskId: string) => BranchLineage | undefined;
}

type BranchLineageStore = BranchLineageStoreState & BranchLineageStoreActions;

export const useBranchLineageStore = create<BranchLineageStore>()(
  persist(
    (set, get) => ({
      lineageByTaskId: {},
      setLineage: (taskId, lineage) =>
        set((state) => ({
          lineageByTaskId: { ...state.lineageByTaskId, [taskId]: lineage },
        })),
      getLineage: (taskId) => get().lineageByTaskId[taskId],
    }),
    {
      name: "branch-lineage-storage",
      partialize: (state) => ({ lineageByTaskId: state.lineageByTaskId }),
    },
  ),
);

/** Subscribe to the lineage for a single task. */
export function useBranchLineage(
  taskId: string | undefined,
): BranchLineage | undefined {
  return useBranchLineageStore((state) =>
    taskId ? state.lineageByTaskId[taskId] : undefined,
  );
}

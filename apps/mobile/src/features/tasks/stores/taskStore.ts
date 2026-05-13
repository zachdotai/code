import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Task } from "../types";

export type OrganizeMode = "by-project" | "chronological";
export type SortMode = "created" | "updated";

interface TaskUIState {
  selectedTaskId: string | null;
  organizeMode: OrganizeMode;
  sortMode: SortMode;
  showInternal: boolean;
  filter: string;

  selectTask: (taskId: string | null) => void;
  setOrganizeMode: (mode: OrganizeMode) => void;
  setSortMode: (mode: SortMode) => void;
  setShowInternal: (showInternal: boolean) => void;
  setFilter: (filter: string) => void;
}

export const useTaskStore = create<TaskUIState>()(
  persist(
    (set) => ({
      selectedTaskId: null,
      organizeMode: "by-project",
      sortMode: "updated",
      showInternal: false,
      filter: "",

      selectTask: (selectedTaskId) => set({ selectedTaskId }),
      setOrganizeMode: (organizeMode) => set({ organizeMode }),
      setSortMode: (sortMode) => set({ sortMode }),
      setShowInternal: (showInternal) => set({ showInternal }),
      setFilter: (filter) => set({ filter }),
    }),
    {
      name: "posthog-task-ui",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        organizeMode: state.organizeMode,
        sortMode: state.sortMode,
        showInternal: state.showInternal,
      }),
    },
  ),
);

export function taskActivityTimestamp(task: Task, sortMode: SortMode): number {
  if (sortMode === "created") {
    return new Date(task.created_at).getTime();
  }
  // "updated" — take the most recent of task.updated_at and latest_run.updated_at.
  const runUpdated = task.latest_run?.updated_at;
  const taskUpdated = task.updated_at ?? task.created_at;
  return Math.max(
    runUpdated ? new Date(runUpdated).getTime() : 0,
    new Date(taskUpdated).getTime(),
  );
}

export function filterAndSortTasks(
  tasks: Task[],
  sortMode: SortMode,
  showInternal: boolean,
  filter: string,
): Task[] {
  let filtered = tasks;

  // Visibility filter — mirrors desktop radio: External hides internal, Internal shows only internal.
  filtered = filtered.filter((task) =>
    showInternal ? task.internal === true : task.internal !== true,
  );

  if (filter) {
    const lowerFilter = filter.toLowerCase();
    filtered = filtered.filter(
      (task) =>
        task.title.toLowerCase().includes(lowerFilter) ||
        task.slug.toLowerCase().includes(lowerFilter) ||
        task.description?.toLowerCase().includes(lowerFilter),
    );
  }

  return [...filtered].sort(
    (a, b) =>
      taskActivityTimestamp(b, sortMode) - taskActivityTimestamp(a, sortMode),
  );
}

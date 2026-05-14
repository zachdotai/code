import { electronStorage } from "@utils/electronStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface WorkThreadsStoreState {
  taskIds: string[];
}

interface WorkThreadsStoreActions {
  addThread: (taskId: string) => void;
  removeThread: (taskId: string) => void;
  isThread: (taskId: string) => boolean;
}

type WorkThreadsStore = WorkThreadsStoreState & WorkThreadsStoreActions;

export const useWorkThreadsStore = create<WorkThreadsStore>()(
  persist(
    (set, get) => ({
      taskIds: [],
      addThread: (taskId: string) =>
        set((state) =>
          state.taskIds.includes(taskId)
            ? state
            : { taskIds: [taskId, ...state.taskIds] },
        ),
      removeThread: (taskId: string) =>
        set((state) => ({
          taskIds: state.taskIds.filter((id) => id !== taskId),
        })),
      isThread: (taskId: string) => get().taskIds.includes(taskId),
    }),
    {
      name: "work-threads-storage",
      storage: electronStorage,
    },
  ),
);

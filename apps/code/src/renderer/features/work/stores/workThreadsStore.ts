import { electronStorage } from "@utils/electronStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * HACKATHON SHORTCUT — local-machine record of task IDs the user created
 * from Work mode. This is the primary signal for "is this a Work thread?"
 * because relying on a server-side marker (`repository_config.work_thread`)
 * has proven unreliable in the current backend without proper schema work.
 *
 * Cross-user sharing still works via `repository_config.collaborators` — the
 * recipient's filter checks that array, not this local store, so they see
 * the thread without us having to sync this store across machines.
 */
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

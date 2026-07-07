import type { QueuedMessage } from "@posthog/shared";
import { logger } from "@posthog/ui/shell/logger";
import { electronStorage } from "@posthog/ui/shell/rendererStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Durable mirror of each session's follow-up `messageQueue`, keyed by taskId, so
 * queued follow-ups survive an app restart (and offline stretches) instead of
 * dying with the in-memory core `sessionStore`.
 *
 * This holds COMMITTED, queued messages — distinct from `pendingTaskPromptStore`
 * (unsent draft composer text for a not-yet-created task). The core store stays
 * the source of truth; `queuedMessagePersistence` keeps this mirror in sync and
 * rehydrates it back into core when a session (re)appears for a task.
 */

const log = logger.scope("queued-messages");

const MAX_TASKS = 50;
const MAX_MESSAGES_PER_TASK = 20;

function capMessages(messages: QueuedMessage[]): QueuedMessage[] {
  if (messages.length <= MAX_MESSAGES_PER_TASK) {
    return messages;
  }
  log.warn("Dropping oldest queued messages beyond per-task cap", {
    dropped: messages.length - MAX_MESSAGES_PER_TASK,
  });
  // Keep the newest (queue tail).
  return messages.slice(-MAX_MESSAGES_PER_TASK);
}

function newestQueuedAt(messages: QueuedMessage[]): number {
  return messages.reduce((max, m) => Math.max(max, m.queuedAt), 0);
}

function capTasks(
  byTaskId: Record<string, QueuedMessage[]>,
): Record<string, QueuedMessage[]> {
  const keys = Object.keys(byTaskId);
  if (keys.length <= MAX_TASKS) {
    return byTaskId;
  }
  const keptKeys = keys
    .sort((a, b) => newestQueuedAt(byTaskId[b]) - newestQueuedAt(byTaskId[a]))
    .slice(0, MAX_TASKS);
  log.warn("Dropping oldest queued-message tasks beyond cap", {
    dropped: keys.length - keptKeys.length,
  });
  const kept: Record<string, QueuedMessage[]> = {};
  for (const key of keptKeys) {
    kept[key] = byTaskId[key];
  }
  return kept;
}

interface QueuedMessageStore {
  byTaskId: Record<string, QueuedMessage[]>;
  _hasHydrated: boolean;
  setHasHydrated: (hydrated: boolean) => void;
  set: (taskId: string, messages: QueuedMessage[]) => void;
  clear: (taskId: string) => void;
  clearAll: () => void;
}

export const useQueuedMessageStore = create<QueuedMessageStore>()(
  persist(
    (set) => ({
      byTaskId: {},
      _hasHydrated: false,
      setHasHydrated: (hydrated) => set({ _hasHydrated: hydrated }),
      set: (taskId, messages) =>
        set((state) => {
          // Empty queue → drop the key so the store only holds live queues.
          if (messages.length === 0) {
            if (!(taskId in state.byTaskId)) {
              return state;
            }
            const { [taskId]: _removed, ...rest } = state.byTaskId;
            return { byTaskId: rest };
          }
          return {
            byTaskId: capTasks({
              ...state.byTaskId,
              [taskId]: capMessages(messages),
            }),
          };
        }),
      clear: (taskId) =>
        set((state) => {
          if (!(taskId in state.byTaskId)) {
            return state;
          }
          const { [taskId]: _removed, ...rest } = state.byTaskId;
          return { byTaskId: rest };
        }),
      clearAll: () => set({ byTaskId: {} }),
    }),
    {
      name: "queued-messages",
      storage: electronStorage,
      partialize: (state) => ({ byTaskId: state.byTaskId }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          useQueuedMessageStore.getState().setHasHydrated(true);
        } else {
          state?.setHasHydrated(true);
        }
      },
    },
  ),
);

export const queuedMessageStoreApi = {
  set: (taskId: string, messages: QueuedMessage[]) =>
    useQueuedMessageStore.getState().set(taskId, messages),
  get: (taskId: string): QueuedMessage[] =>
    useQueuedMessageStore.getState().byTaskId[taskId] ?? [],
  clear: (taskId: string) => useQueuedMessageStore.getState().clear(taskId),
  clearAll: () => useQueuedMessageStore.getState().clearAll(),
  whenHydrated: (): Promise<void> => {
    if (useQueuedMessageStore.getState()._hasHydrated) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const unsubscribe = useQueuedMessageStore.subscribe((state) => {
        if (state._hasHydrated) {
          unsubscribe();
          resolve();
        }
      });
    });
  },
};

import { createStore } from "zustand/vanilla";

export interface CollectionSyncStatus {
  syncing: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  /** Consecutive failures — drives scheduler backoff and future banner UX. */
  failureCount: number;
}

export interface SyncStatusState {
  /** True in the window/tab that owns the sync loops. */
  isLeader: boolean;
  collections: Record<string, CollectionSyncStatus>;
}

const EMPTY: CollectionSyncStatus = {
  syncing: false,
  lastSyncedAt: null,
  lastError: null,
  failureCount: 0,
};

export const syncStatusStore = createStore<SyncStatusState>(() => ({
  isLeader: false,
  collections: {},
}));

export const syncStatusSetters = {
  setLeader(isLeader: boolean): void {
    syncStatusStore.setState({ isLeader });
  },

  markSyncing(collection: string): void {
    syncStatusStore.setState((state) => ({
      collections: {
        ...state.collections,
        [collection]: {
          ...(state.collections[collection] ?? EMPTY),
          syncing: true,
        },
      },
    }));
  },

  markSynced(collection: string, at: string): void {
    syncStatusStore.setState((state) => ({
      collections: {
        ...state.collections,
        [collection]: {
          syncing: false,
          lastSyncedAt: at,
          lastError: null,
          failureCount: 0,
        },
      },
    }));
  },

  markFailed(collection: string, error: string): void {
    syncStatusStore.setState((state) => {
      const previous = state.collections[collection] ?? EMPTY;
      return {
        collections: {
          ...state.collections,
          [collection]: {
            ...previous,
            syncing: false,
            lastError: error,
            failureCount: previous.failureCount + 1,
          },
        },
      };
    });
  },

  reset(): void {
    syncStatusStore.setState({ isLeader: false, collections: {} });
  },
};

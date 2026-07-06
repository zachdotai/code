import { TypedEventEmitter } from "@posthog/shared";
import { subscribeWithSelector } from "zustand/middleware";
import { createStore, type Mutate, type StoreApi } from "zustand/vanilla";
import type { SyncedEntity } from "./schemas";

/** Pool store with the subscribeWithSelector overloads preserved. */
export type PoolStoreApi<T extends SyncedEntity> = Mutate<
  StoreApi<PoolState<T>>,
  [["zustand/subscribeWithSelector", never]]
>;

/**
 * One collection's in-memory object pool: the ONLY read path domain UI uses.
 * Normalized `{ids, entities}` so selectors stay narrow (per-entity) and
 * upserts never invalidate unrelated subscribers.
 */
export interface PoolState<T extends SyncedEntity> {
  /** Insertion-ordered ids. Ordering for views is a selector concern. */
  ids: string[];
  entities: Record<string, T>;
  /** True once boot hydration (or first sync) has populated this pool. */
  hydrated: boolean;
}

export interface PoolChange<T extends SyncedEntity> {
  upserts: T[];
  deletes: string[];
  /**
   * False for changes that must NOT be written to local persistence:
   * optimistic writes, hydration echoes, and follower broadcast applies.
   */
  persist: boolean;
  /**
   * When persisting, write these rows instead of `upserts`. Used when the
   * pool shows rebased/overlaid state but only acknowledged server state may
   * reach the model tables.
   */
  persistUpserts?: T[];
}

interface PoolEvents<T extends SyncedEntity> {
  change: PoolChange<T>;
}

export interface ApplyOptions {
  persist?: boolean;
  /** Rows to persist in place of the applied rows (acknowledged state). */
  persistRows?: readonly SyncedEntity[];
}

export interface EntityPool<T extends SyncedEntity> {
  readonly name: string;
  readonly store: PoolStoreApi<T>;
  readonly changes: TypedEventEmitter<PoolEvents<T>>;

  applyUpserts(rows: readonly T[], options?: ApplyOptions): void;
  applyDeletes(ids: readonly string[], options?: ApplyOptions): void;
  /** Hydration: replace pool contents without persisting (already durable). */
  replaceAll(rows: readonly T[]): void;
  markHydrated(): void;
  /** Wipe in-memory state (logout/namespace switch). Never persists. */
  clear(): void;

  get(id: string): T | undefined;
  getAll(): T[];
}

export function createEntityPool<T extends SyncedEntity>(
  name: string,
): EntityPool<T> {
  const store = createStore<PoolState<T>>()(
    subscribeWithSelector(
      (): PoolState<T> => ({
        ids: [],
        entities: {},
        hydrated: false,
      }),
    ),
  );

  const changes = new TypedEventEmitter<PoolEvents<T>>();

  const applyUpserts = (rows: readonly T[], options?: ApplyOptions): void => {
    if (rows.length === 0) return;
    store.setState((state) => {
      const entities = { ...state.entities };
      let ids = state.ids;
      let appended: string[] | null = null;
      for (const row of rows) {
        if (!(row.id in entities)) {
          appended ??= [];
          appended.push(row.id);
        }
        entities[row.id] = row;
      }
      if (appended) ids = [...state.ids, ...appended];
      return { ids, entities };
    });
    changes.emit("change", {
      upserts: [...rows],
      deletes: [],
      persist: options?.persist ?? true,
      persistUpserts: options?.persistRows
        ? ([...options.persistRows] as T[])
        : undefined,
    });
  };

  const applyDeletes = (
    ids: readonly string[],
    options?: ApplyOptions,
  ): void => {
    if (ids.length === 0) return;
    const removed = new Set(ids);
    store.setState((state) => {
      const entities = { ...state.entities };
      let changed = false;
      for (const id of ids) {
        if (id in entities) {
          delete entities[id];
          changed = true;
        }
      }
      if (!changed) return state;
      return {
        ids: state.ids.filter((id) => !removed.has(id)),
        entities,
      };
    });
    changes.emit("change", {
      upserts: [],
      deletes: [...ids],
      persist: options?.persist ?? true,
    });
  };

  return {
    name,
    store,
    changes,
    applyUpserts,
    applyDeletes,
    replaceAll(rows: readonly T[]): void {
      const entities: Record<string, T> = {};
      const ids: string[] = [];
      for (const row of rows) {
        if (!(row.id in entities)) ids.push(row.id);
        entities[row.id] = row;
      }
      store.setState({ ids, entities });
    },
    markHydrated(): void {
      if (!store.getState().hydrated) {
        store.setState({ hydrated: true });
      }
    },
    clear(): void {
      store.setState({ ids: [], entities: {}, hydrated: false });
    },
    get(id: string): T | undefined {
      return store.getState().entities[id];
    },
    getAll(): T[] {
      const { ids, entities } = store.getState();
      return ids
        .map((id) => entities[id])
        .filter((e): e is T => e !== undefined);
    },
  };
}

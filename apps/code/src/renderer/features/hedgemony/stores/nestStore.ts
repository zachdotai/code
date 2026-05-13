import type { Nest } from "@main/services/hedgemony/schemas";
import { trpcClient } from "@renderer/trpc/client";
import { logger } from "@utils/logger";
import { create } from "zustand";

const log = logger.scope("nest-store");

interface NestStoreState {
  nests: Record<string, Nest>;
  loaded: boolean;
}

interface NestStoreActions {
  setAll: (nests: Nest[]) => void;
  upsert: (nest: Nest) => void;
  remove: (id: string) => void;
}

type NestStore = NestStoreState & NestStoreActions;

export const useNestStore = create<NestStore>()((set) => ({
  nests: {},
  loaded: false,

  setAll: (nests) =>
    set({
      nests: Object.fromEntries(nests.map((n) => [n.id, n])),
      loaded: true,
    }),

  upsert: (nest) =>
    set((state) => ({
      nests: { ...state.nests, [nest.id]: nest },
    })),

  remove: (id) =>
    set((state) => {
      const next = { ...state.nests };
      delete next[id];
      return { nests: next };
    }),
}));

export const selectNests = (state: NestStore): Nest[] =>
  Object.values(state.nests).filter((n) => n.status !== "archived");

type WatchHandle = { unsubscribe: () => void };

/**
 * Subscribes to a single nest's watch stream. Updates the store on each
 * event and detaches itself when the nest archives.
 */
function watchNest(id: string): WatchHandle {
  const sub = trpcClient.hedgemony.nests.watch.subscribe(
    { id },
    {
      onData: (event) => {
        const store = useNestStore.getState();
        if (event.kind === "archived") {
          store.remove(event.nest.id);
        } else {
          store.upsert(event.nest);
        }
      },
      onError: (error) =>
        log.error("nest watch subscription error", { id, error }),
    },
  );
  return sub;
}

/**
 * Bootstraps the store: fetches the current nest list and opens per-nest
 * watch subscriptions. Returns a disposer that unsubscribes from everything.
 *
 * For Slice 1 the only producer of `nest-changed` events is local mutation
 * (this client). The per-nest watch shape is locked in now so signal-driven
 * roster changes (Slice 4+) plug in without a router rewrite.
 */
export function initializeNestStore(): () => void {
  const watches = new Map<string, WatchHandle>();
  let disposed = false;

  const openWatch = (id: string) => {
    if (disposed || watches.has(id)) return;
    watches.set(id, watchNest(id));
  };

  const closeWatch = (id: string) => {
    const handle = watches.get(id);
    if (!handle) return;
    handle.unsubscribe();
    watches.delete(id);
  };

  // Mirror store state to open subscriptions.
  const unsub = useNestStore.subscribe((state, prev) => {
    const current = new Set(Object.keys(state.nests));
    const previous = new Set(Object.keys(prev.nests));
    for (const id of current) if (!previous.has(id)) openWatch(id);
    for (const id of previous) if (!current.has(id)) closeWatch(id);
  });

  trpcClient.hedgemony.nests.list
    .query()
    .then((nests) => {
      if (disposed) return;
      useNestStore.getState().setAll(nests);
      for (const n of nests) openWatch(n.id);
    })
    .catch((error) => log.error("Failed to load nests", { error }));

  return () => {
    disposed = true;
    unsub();
    for (const id of [...watches.keys()]) closeWatch(id);
  };
}

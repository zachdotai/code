import { trpcClient } from "@renderer/trpc/client";
import { logger } from "@utils/logger";
import { useNestStore } from "../stores/nestStore";

const log = logger.scope("nest-subscription-service");

type WatchHandle = { unsubscribe: () => void };

/**
 * Subscribes to a single nest's watch stream. Updates the store on each
 * event and detaches itself when the nest archives.
 */
function watchNest(id: string): WatchHandle {
  return trpcClient.hedgemony.nests.watch.subscribe(
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

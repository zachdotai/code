import { logger } from "@posthog/ui/shell/logger";
import { trpcNestRemoteService } from "../adapters/trpcNestRemoteService";
import { zustandNestChatRepository } from "../adapters/zustandNestChatRepository";
import { zustandNestRepository } from "../adapters/zustandNestRepository";
import type { NestChatRepository } from "../domain/NestChatRepository";
import type {
  NestRemoteService,
  WatchHandle,
} from "../domain/NestRemoteService";
import type { NestRepository } from "../domain/NestRepository";

const log = logger.scope("nest-subscription-service");

export interface NestSubscriptionDeps {
  nests: NestRepository;
  chat: NestChatRepository;
  remote: NestRemoteService;
}

export const defaultNestSubscriptionDeps: NestSubscriptionDeps = {
  nests: zustandNestRepository,
  chat: zustandNestChatRepository,
  remote: trpcNestRemoteService,
};

/**
 * Subscribes to a single nest's watch stream. The watch channel multiplexes
 * six event kinds — status/activated/validated/archived (nest CRUD),
 * hedgehog_tick (sprite glow state), and message_appended (live chat append).
 * `status`, `activated`, and `validated` all upsert the nest row so the
 * renderer sees the new status (active/validated/dormant/etc.) without
 * re-fetching; only the main-process tick scheduler distinguishes them.
 */
function watchNest(id: string, deps: NestSubscriptionDeps): WatchHandle {
  return deps.remote.watch(id, {
    onData: (event) => {
      switch (event.kind) {
        case "archived":
          deps.nests.remove(event.nest.id);
          return;
        case "status":
        case "activated":
        case "validated":
          deps.nests.upsert(event.nest);
          return;
        case "hedgehog_tick":
          deps.nests.setHedgehogState(id, event.state);
          return;
        case "message_appended":
          deps.chat.append(id, event.message);
          return;
      }
    },
    onError: (error) =>
      log.error("nest watch subscription error", { id, error }),
  });
}

/**
 * Bootstraps the store: fetches the current nest list and opens per-nest
 * watch subscriptions. Returns a disposer that unsubscribes from everything.
 *
 * For Slice 1 the only producer of `nest-changed` events is local mutation
 * (this client). The per-nest watch shape is locked in now so signal-driven
 * roster changes (Slice 4+) plug in without a router rewrite.
 */
export function initializeNestStore(
  deps: NestSubscriptionDeps = defaultNestSubscriptionDeps,
): () => void {
  const watches = new Map<string, WatchHandle>();
  let disposed = false;

  const openWatch = (id: string) => {
    if (disposed || watches.has(id)) return;
    watches.set(id, watchNest(id, deps));
  };

  const closeWatch = (id: string) => {
    const handle = watches.get(id);
    if (!handle) return;
    handle.unsubscribe();
    watches.delete(id);
  };

  const unsub = deps.nests.subscribeToKeys((added, removed) => {
    for (const id of added) openWatch(id);
    for (const id of removed) closeWatch(id);
  });

  // No watch is open yet (watches are per-nest, opened from the keys
  // subscriber once setAll seeds the repository). Race window is therefore
  // between `nests.list` resolving and the keys subscriber reacting. The
  // keys subscriber runs synchronously on setAll, so openWatch fires
  // immediately for each new id and watch events for those nests can only
  // arrive after the bucket exists.
  deps.remote
    .list()
    .then((nests) => {
      if (disposed) return;
      deps.nests.setAll(nests);
      for (const n of nests) openWatch(n.id);
    })
    .catch((error) => log.error("Failed to load nests", { error }));

  return () => {
    disposed = true;
    unsub();
    for (const id of [...watches.keys()]) closeWatch(id);
  };
}

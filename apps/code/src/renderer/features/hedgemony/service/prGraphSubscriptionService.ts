import type { PrGraphWatchEvent } from "@main/services/hedgemony/schemas";
import { logger } from "@utils/logger";
import { trpcPrGraphRemoteService } from "../adapters/trpcPrGraphRemoteService";
import { zustandPrGraphRepository } from "../adapters/zustandPrGraphRepository";
import type { WatchHandle } from "../domain/NestRemoteService";
import type { PrGraphRemoteService } from "../domain/PrGraphRemoteService";
import type { PrGraphRepository } from "../domain/PrGraphRepository";

const log = logger.scope("pr-graph-subscription-service");

export interface PrGraphSubscriptionDeps {
  prGraph: PrGraphRepository;
  remote: PrGraphRemoteService;
}

export const defaultPrGraphSubscriptionDeps: PrGraphSubscriptionDeps = {
  prGraph: zustandPrGraphRepository,
  remote: trpcPrGraphRemoteService,
};

function applyWatchEvent(
  nestId: string,
  event: PrGraphWatchEvent,
  prGraph: PrGraphRepository,
): void {
  if (event.kind === "upsert") prGraph.upsert(nestId, event.edge);
  else prGraph.remove(nestId, event.edgeId);
}

/**
 * Bootstraps PR-graph edges for a single nest: fetches the current edge list,
 * opens a watch subscription, and returns a disposer.
 *
 * Mounted from `HedgemonyMapView` (or `NestBroodCluster`) per active nest so
 * detail panels and sprite badges can read edges out of `usePrGraphStore`
 * without orchestrating their own fetch lifecycle.
 */
export function initializePrGraphForNest(
  nestId: string,
  deps: PrGraphSubscriptionDeps = defaultPrGraphSubscriptionDeps,
): () => void {
  let disposed = false;
  let initialLoaded = false;
  const buffered: PrGraphWatchEvent[] = [];

  const watch: WatchHandle = deps.remote.watch(nestId, {
    onData: (event) => {
      if (disposed) return;
      if (!initialLoaded) {
        buffered.push(event);
        return;
      }
      applyWatchEvent(nestId, event, deps.prGraph);
    },
    onError: (error) =>
      log.error("pr-graph watch subscription error", { nestId, error }),
  });

  deps.remote
    .listForNest(nestId)
    .then((edges) => {
      if (disposed) return;
      deps.prGraph.setForNest(nestId, edges);
      // Replay any events that arrived between subscribe and list-resolve so
      // upserts/removes don't get clobbered by the initial seed.
      for (const event of buffered)
        applyWatchEvent(nestId, event, deps.prGraph);
      buffered.length = 0;
      initialLoaded = true;
    })
    .catch((error) =>
      log.error("Failed to load nest pr-graph edges", { nestId, error }),
    );

  return () => {
    if (disposed) return;
    disposed = true;
    watch.unsubscribe();
  };
}

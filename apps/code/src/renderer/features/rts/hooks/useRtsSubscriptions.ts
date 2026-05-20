import { useEffect, useMemo, useRef } from "react";
import { initializeWildHogletStore } from "../service/hogletSubscriptionService";
import { initializeNestStore } from "../service/nestSubscriptionService";
import { initializePrGraphForNest } from "../service/prGraphSubscriptionService";

export interface UseRtsSubscriptionsOptions {
  /** Live nest IDs the view is rendering. The hook opens / closes one PR-graph
   * subscription per id, keyed by membership so nests being reshuffled in the
   * array doesn't churn every subscription. */
  nestIds: string[];
}

/**
 * Owns the long-lived subscription lifecycle for the map view: wild-hoglet
 * stream, nest stream, and per-nest PR-graph streams. Side-effect only —
 * mount the hook and it keeps the stores fresh until the map unmounts.
 */
export function useRtsSubscriptions({
  nestIds,
}: UseRtsSubscriptionsOptions): void {
  useEffect(() => {
    return initializeWildHogletStore();
  }, []);

  useEffect(() => {
    return initializeNestStore();
  }, []);

  // Slice 8 — bootstrap a PR-graph edge subscription per nest. Each nest
  // disposer is keyed by id in a ref so we open/close incrementally when nests
  // are added/removed, rather than tearing down every subscription whenever
  // the `nests` array reshuffles (e.g. on status updates that mutate the
  // record but keep the same membership).
  const prGraphDisposersRef = useRef<Map<string, () => void>>(new Map());
  const nestIdsKey = useMemo(() => nestIds.join(","), [nestIds]);

  useEffect(() => {
    const disposers = prGraphDisposersRef.current;
    const liveIds = new Set(nestIdsKey ? nestIdsKey.split(",") : []);
    for (const id of liveIds) {
      if (!disposers.has(id)) {
        disposers.set(id, initializePrGraphForNest(id));
      }
    }
    for (const [id, dispose] of disposers) {
      if (!liveIds.has(id)) {
        dispose();
        disposers.delete(id);
      }
    }
  }, [nestIdsKey]);

  useEffect(() => {
    const disposers = prGraphDisposersRef.current;
    return () => {
      for (const dispose of disposers.values()) dispose();
      disposers.clear();
    };
  }, []);
}

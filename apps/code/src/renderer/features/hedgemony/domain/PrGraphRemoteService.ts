import type {
  PrDependencyView,
  PrGraphWatchEvent,
} from "@main/services/hedgemony/schemas";
import type { WatchCallbacks, WatchHandle } from "./NestRemoteService";

/**
 * Narrow interface over the remote PR-graph API used by the pr-graph
 * subscription service.
 */
export interface PrGraphRemoteService {
  listForNest(nestId: string): Promise<PrDependencyView[]>;
  watch(
    nestId: string,
    callbacks: WatchCallbacks<PrGraphWatchEvent>,
  ): WatchHandle;
}

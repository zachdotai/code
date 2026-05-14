import type {
  AdoptHogletInput,
  Hoglet,
  HogletWatchEvent,
  HogletWatchScope,
  ListHogletsInput,
  ReleaseHogletInput,
} from "@main/services/hedgemony/schemas";
import type { WatchCallbacks, WatchHandle } from "./NestRemoteService";

/**
 * Narrow interface over the remote hoglet API used by mutations and the
 * hoglet subscription service. tRPC is one implementation; tests use fakes.
 */
export interface HogletRemoteService {
  adopt(input: AdoptHogletInput): Promise<Hoglet>;
  release(input: ReleaseHogletInput): Promise<Hoglet>;
  list(input: ListHogletsInput): Promise<Hoglet[]>;
  watch(
    scope: HogletWatchScope,
    callbacks: WatchCallbacks<HogletWatchEvent>,
  ): WatchHandle;
}

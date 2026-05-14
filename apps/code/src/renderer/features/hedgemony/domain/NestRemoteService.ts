import type {
  Nest,
  NestWatchEvent,
  UpdateNestInput,
} from "@main/services/hedgemony/schemas";

/**
 * Subscription handle returned by remote-service watch methods. Wraps the
 * underlying transport (tRPC subscription, in-memory queue) so callers see a
 * uniform shape regardless of transport.
 */
export interface WatchHandle {
  unsubscribe(): void;
}

export interface WatchCallbacks<TEvent> {
  onData(event: TEvent): void;
  onError(error: unknown): void;
}

/**
 * Narrow interface over the remote nest API used by mutations and the nest
 * subscription service. tRPC is one implementation; tests use fakes.
 */
export interface NestRemoteService {
  update(input: UpdateNestInput): Promise<Nest>;
  list(): Promise<Nest[]>;
  watch(id: string, callbacks: WatchCallbacks<NestWatchEvent>): WatchHandle;
}

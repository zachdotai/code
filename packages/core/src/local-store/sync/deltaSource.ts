import type { SyncedEntity } from "../schemas";

/**
 * One fetched pull window: the rows the server returned for a specific query
 * scope, plus the sweep contract that makes client-only deletion detection
 * safe. THE invariant of this engine: a sweep may only evict local rows that
 * (a) match the window's scope predicate and (b) were covered by a COMPLETE
 * (non-truncated) response. Sweep scope == pull scope, always.
 */
export interface PulledWindow<T extends SyncedEntity> {
  /** Stable identity for this window's scope (cursors/hashes key off it). */
  key: string;
  /**
   * Target collection when one fetch feeds several (e.g. a channel pull
   * yields task rows AND the channel's membership row). Defaults to the
   * source's own collection.
   */
  collection?: string;
  rows: T[];
  sweep: {
    /** False when the response was truncated (e.g. hit the limit). */
    complete: boolean;
    /** Which local rows this window's scope covers. */
    matches(row: T): boolean;
  } | null;
}

/**
 * A pull-based delta source for one collection — the server-ready seam. Today:
 * REST pollers emulating deltas via windowed pulls + diffing. Tomorrow: a
 * websocket sync-log source feeding the same apply pipeline.
 */
export interface DeltaSource<T extends SyncedEntity = SyncedEntity> {
  readonly collection: string;
  /** Base cadence between pulls (scheduler adds jitter and backoff). */
  readonly intervalMs: number;
  /**
   * Fetch the current window(s). Return null to skip this tick (e.g. no
   * authenticated client available yet).
   */
  pull(): Promise<PulledWindow<T>[] | null>;
}

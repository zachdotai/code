import {
  ROOT_LOGGER,
  type RootLogger,
  type ScopedLogger,
} from "@posthog/di/logger";
import { inject, injectable } from "inversify";
import type { SyncedEntity } from "../schemas";
import type { AppliedDelta, ApplyPipeline } from "./applyPipeline";
import type { DeltaSource } from "./deltaSource";
import { APPLY_PIPELINE } from "./identifiers";
import { syncStatusSetters } from "./syncStatusStore";

const MAX_BACKOFF_MS = 5 * 60_000;
const JITTER_RATIO = 0.15;

interface ScheduledSource {
  source: DeltaSource<SyncedEntity>;
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  failureCount: number;
}

/**
 * THE one owner of background freshness: every collection's pull cadence
 * lives here (with jitter and per-source exponential backoff) instead of
 * scattered per-hook `refetchInterval`s. Runs only in the leader window;
 * pokes re-pull immediately (the seam a future server push plugs into).
 */
@injectable()
export class SyncScheduler {
  private readonly sources = new Map<string, ScheduledSource>();
  private started = false;
  private onDelta: ((delta: AppliedDelta) => void) | null = null;
  private readonly log: ScopedLogger;

  constructor(
    @inject(APPLY_PIPELINE)
    private readonly applyPipeline: ApplyPipeline,
    @inject(ROOT_LOGGER)
    rootLogger: RootLogger,
  ) {
    this.log = rootLogger.scope("local-store:scheduler");
  }

  register(source: DeltaSource<SyncedEntity>): void {
    if (this.sources.has(source.collection)) return;
    const entry: ScheduledSource = {
      source,
      timer: null,
      running: false,
      failureCount: 0,
    };
    this.sources.set(source.collection, entry);
    if (this.started) this.runSoon(entry, 0);
  }

  /** Applied deltas stream here (the engine broadcasts them to followers). */
  setDeltaListener(listener: ((delta: AppliedDelta) => void) | null): void {
    this.onDelta = listener;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    for (const entry of this.sources.values()) {
      this.runSoon(entry, 0);
    }
  }

  stop(): void {
    this.started = false;
    for (const entry of this.sources.values()) {
      if (entry.timer !== null) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
    }
  }

  /** Pull everything now (focus/reconnect/poke). No-op unless started. */
  pokeAll(): void {
    if (!this.started) return;
    for (const entry of this.sources.values()) {
      this.runSoon(entry, 0);
    }
  }

  poke(collection: string): void {
    const entry = this.sources.get(collection);
    if (entry && this.started) this.runSoon(entry, 0);
  }

  private runSoon(entry: ScheduledSource, delayMs: number): void {
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    entry.timer = setTimeout(() => {
      entry.timer = null;
      void this.tick(entry);
    }, delayMs);
  }

  private async tick(entry: ScheduledSource): Promise<void> {
    if (!this.started || entry.running) return;
    entry.running = true;
    const { collection } = entry.source;
    syncStatusSetters.markSyncing(collection);
    try {
      const windows = await entry.source.pull();
      if (windows !== null) {
        const delta = this.applyPipeline.applyWindows(collection, windows);
        if (
          this.onDelta &&
          (delta.upserts.length > 0 || delta.deletes.length > 0)
        ) {
          this.onDelta(delta);
        }
        syncStatusSetters.markSynced(collection, new Date().toISOString());
      } else {
        // Source skipped (e.g. unauthenticated) — not a failure.
        syncStatusSetters.markSynced(collection, new Date().toISOString());
      }
      entry.failureCount = 0;
    } catch (error) {
      entry.failureCount += 1;
      const message = error instanceof Error ? error.message : String(error);
      syncStatusSetters.markFailed(collection, message);
      this.log.warn(
        `pull failed for ${collection} (attempt ${entry.failureCount}): ${message}`,
      );
    } finally {
      entry.running = false;
      if (this.started) {
        this.runSoon(entry, this.nextDelay(entry));
      }
    }
  }

  private nextDelay(entry: ScheduledSource): number {
    const base = entry.source.intervalMs;
    const backoff =
      entry.failureCount > 0
        ? Math.min(base * 2 ** entry.failureCount, MAX_BACKOFF_MS)
        : base;
    const jitter = backoff * JITTER_RATIO * Math.random();
    return backoff + jitter;
  }
}

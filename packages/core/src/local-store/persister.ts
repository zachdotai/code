import {
  ROOT_LOGGER,
  type RootLogger,
  type ScopedLogger,
} from "@posthog/di/logger";
import type {
  LocalPersistenceHandle,
  LocalStoreRecord,
} from "@posthog/platform/local-persistence";
import { inject, injectable } from "inversify";
import type { EntityRegistry } from "./entityRegistry";
import { ENTITY_REGISTRY } from "./identifiers";
import type { PoolChange } from "./poolStore";
import { entityUpdatedAt, type SyncedEntity } from "./schemas";

interface PendingCollection {
  upserts: Map<string, SyncedEntity>;
  deletes: Set<string>;
}

const DEFAULT_FLUSH_INTERVAL_MS = 200;

/**
 * Write-behind persistence: subscribes to every pool's change events and
 * batches acknowledged-state rows into the LocalPersistence handle. Changes
 * flagged `persist: false` (hydration echoes, follower broadcast applies)
 * never reach disk — the leader owns all persistence writes.
 */
@injectable()
export class Persister {
  private handle: LocalPersistenceHandle | null = null;
  private readonly pending = new Map<string, PendingCollection>();
  private readonly unsubscribers: Array<() => void> = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  private readonly log: ScopedLogger;

  constructor(
    @inject(ENTITY_REGISTRY)
    private readonly registry: EntityRegistry,
    @inject(ROOT_LOGGER)
    rootLogger: RootLogger,
    private readonly flushIntervalMs: number = DEFAULT_FLUSH_INTERVAL_MS,
  ) {
    this.log = rootLogger.scope("local-store:persister");
  }

  attach(handle: LocalPersistenceHandle): void {
    this.detachListeners();
    this.handle = handle;
    for (const { definition, pool } of this.registry.all()) {
      const listener = (change: PoolChange<SyncedEntity>) => {
        if (!change.persist) return;
        this.buffer(definition.name, change);
        this.scheduleFlush();
      };
      pool.changes.on("change", listener);
      this.unsubscribers.push(() => pool.changes.off("change", listener));
    }
  }

  /** Stop listening, flush what's buffered, and release the handle. */
  async detach(): Promise<void> {
    this.detachListeners();
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
    this.handle = null;
  }

  /** Drain the buffer to persistence now. Safe to call concurrently. */
  async flush(): Promise<void> {
    if (this.flushing) {
      await this.flushing;
    }
    const handle = this.handle;
    if (!handle || this.pending.size === 0) return;

    const batch = new Map(this.pending);
    this.pending.clear();

    const run = (async () => {
      const puts: LocalStoreRecord[] = [];
      for (const [collection, changes] of batch) {
        const definition = this.registry.getDefinition(collection);
        if (!definition) continue;
        for (const entity of changes.upserts.values()) {
          puts.push({
            collection,
            id: entity.id,
            updatedAt: entityUpdatedAt(definition, entity),
            data: entity,
          });
        }
      }
      try {
        if (puts.length > 0) {
          await handle.bulkPut(puts);
        }
        for (const [collection, changes] of batch) {
          if (changes.deletes.size > 0) {
            await handle.bulkDelete(collection, [...changes.deletes]);
          }
        }
      } catch (error) {
        this.log.error("flush failed; re-buffering batch", error);
        for (const [collection, changes] of batch) {
          const target = this.getPending(collection);
          for (const [id, entity] of changes.upserts) {
            if (!target.deletes.has(id)) target.upserts.set(id, entity);
          }
          for (const id of changes.deletes) {
            target.upserts.delete(id);
            target.deletes.add(id);
          }
        }
        this.scheduleFlush();
      }
    })();

    this.flushing = run;
    try {
      await run;
    } finally {
      if (this.flushing === run) this.flushing = null;
    }
  }

  private buffer(collection: string, change: PoolChange<SyncedEntity>): void {
    const target = this.getPending(collection);
    for (const entity of change.persistUpserts ?? change.upserts) {
      target.deletes.delete(entity.id);
      target.upserts.set(entity.id, entity);
    }
    for (const id of change.deletes) {
      target.upserts.delete(id);
      target.deletes.add(id);
    }
  }

  private getPending(collection: string): PendingCollection {
    let target = this.pending.get(collection);
    if (!target) {
      target = { upserts: new Map(), deletes: new Set() };
      this.pending.set(collection, target);
    }
    return target;
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.flushIntervalMs);
  }

  private detachListeners(): void {
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe();
    }
  }
}

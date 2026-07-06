import {
  ROOT_LOGGER,
  type RootLogger,
  type ScopedLogger,
} from "@posthog/di/logger";
import { inject, injectable } from "inversify";
import type { EntityRegistry } from "../entityRegistry";
import { ENTITY_REGISTRY } from "../identifiers";
import { entityUpdatedAt, type SyncedEntity } from "../schemas";
import { contentHash } from "./contentHash";
import type { PulledWindow } from "./deltaSource";

/** Delta applied to a pool — broadcast to follower windows by the engine. */
export interface AppliedDelta {
  collection: string;
  upserts: SyncedEntity[];
  deletes: string[];
}

/**
 * The single choke point for remote state entering pools: content-hash
 * short-circuit → Zod parse → LWW compare → scoped deletion sweep → pool
 * apply (persisted write-behind). Every DeltaSource pull and (later) every
 * mutation ack flows through here; a future server sync log reuses it as-is.
 */
@injectable()
export class ApplyPipeline {
  /** window key → last applied content hash (in-memory; repopulates cheaply). */
  private windowHashes = new Map<string, string>();
  private readonly log: ScopedLogger;

  constructor(
    @inject(ENTITY_REGISTRY)
    private readonly registry: EntityRegistry,
    @inject(ROOT_LOGGER)
    rootLogger: RootLogger,
  ) {
    this.log = rootLogger.scope("local-store:apply");
  }

  resetHashes(): void {
    this.windowHashes.clear();
  }

  /**
   * Apply pulled windows for a collection. Returns the delta that actually
   * changed pools (empty arrays when everything short-circuited).
   */
  applyWindows(
    collection: string,
    windows: PulledWindow<SyncedEntity>[],
  ): AppliedDelta {
    const definition = this.registry.getDefinition(collection);
    if (!definition) {
      throw new Error(`Unknown entity collection "${collection}"`);
    }
    const pool = this.registry.getPool<SyncedEntity>(collection);

    const upserts: SyncedEntity[] = [];
    const deletes: string[] = [];

    for (const window of windows) {
      const hashKey = `${collection}:${window.key}`;
      const hash = contentHash(window.rows);
      if (this.windowHashes.get(hashKey) === hash) {
        continue; // Unchanged window: zero writes, zero renders.
      }

      const parsed: SyncedEntity[] = [];
      let dropped = 0;
      for (const row of window.rows) {
        const result = definition.schema.safeParse(row);
        if (result.success) {
          parsed.push(result.data);
        } else {
          dropped += 1;
        }
      }
      if (dropped > 0) {
        this.log.warn(
          `dropped ${dropped} invalid row(s) from ${collection} window "${window.key}"`,
        );
      }

      const windowIds = new Set(parsed.map((row) => row.id));

      for (const row of parsed) {
        const existing = pool.get(row.id);
        if (existing && this.localWins(definition, existing, row)) {
          continue; // Last-write-wins: local copy is newer or identical.
        }
        upserts.push(row);
      }

      // Deletion sweep — ONLY within this window's scope, ONLY when complete.
      if (window.sweep?.complete) {
        const { matches } = window.sweep;
        for (const row of pool.getAll()) {
          if (matches(row) && !windowIds.has(row.id)) {
            deletes.push(row.id);
          }
        }
      }

      this.windowHashes.set(hashKey, hash);
    }

    if (upserts.length > 0) pool.applyUpserts(upserts);
    if (deletes.length > 0) pool.applyDeletes(deletes);
    if (!pool.store.getState().hydrated) pool.markHydrated();

    return { collection, upserts, deletes };
  }

  /** Apply a delta broadcast by the leader window. Never persists. */
  applyBroadcast(delta: AppliedDelta): void {
    const definition = this.registry.getDefinition(delta.collection);
    if (!definition) return;
    const pool = this.registry.getPool<SyncedEntity>(delta.collection);

    const valid: SyncedEntity[] = [];
    for (const row of delta.upserts) {
      const result = definition.schema.safeParse(row);
      if (result.success) valid.push(result.data);
    }
    if (valid.length > 0) pool.applyUpserts(valid, { persist: false });
    if (delta.deletes.length > 0) {
      pool.applyDeletes(delta.deletes, { persist: false });
    }
    if (!pool.store.getState().hydrated) pool.markHydrated();
  }

  private localWins(
    definition: NonNullable<ReturnType<EntityRegistry["getDefinition"]>>,
    existing: SyncedEntity,
    incoming: SyncedEntity,
  ): boolean {
    const existingAt = entityUpdatedAt(definition, existing);
    const incomingAt = entityUpdatedAt(definition, incoming);
    if (existingAt === null || incomingAt === null) return false;
    if (existingAt > incomingAt) return true;
    if (existingAt < incomingAt) return false;
    // Identical timestamps: skip only if content is identical too.
    return contentHash(existing) === contentHash(incoming);
  }
}

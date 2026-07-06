import {
  ROOT_LOGGER,
  type RootLogger,
  type ScopedLogger,
} from "@posthog/di/logger";
import type {
  NewOutboxEntry,
  OutboxEntry,
} from "@posthog/platform/local-persistence";
import { TypedEventEmitter } from "@posthog/shared";
import { inject, injectable } from "inversify";
import type { EntityRegistry } from "../entityRegistry";
import { ENTITY_REGISTRY, LOCAL_STORE_SERVICE } from "../identifiers";
import type { LocalStoreService } from "../localStoreService";
import type { SyncedEntity } from "../schemas";

export interface OutboxEvents {
  enqueued: OutboxEntry;
  flushed: OutboxEntry;
  parked: { entry: OutboxEntry; error: string };
}

export interface EnqueueInput {
  collection: string;
  recordId: string;
  op: string;
  /** JSON-safe changed fields (updates) or creation payload. */
  payload: Record<string, unknown>;
  /** JSON-safe inverse values for rollback (and future undo). */
  oldValues: Record<string, unknown>;
}

/**
 * The durable mutation queue. Entries are persisted BEFORE any network send
 * (a crash never loses a user write), replayed onto pools at boot so pending
 * writes stay visible, and merged over incoming pulls (rebase) so optimistic
 * fields never flicker away. Optimism lives here and in pool memory only —
 * model tables always hold acknowledged server state.
 */
@injectable()
export class Outbox {
  readonly events = new TypedEventEmitter<OutboxEvents>();
  /** In-memory mirror of persisted entries, in seq order. */
  private entries: OutboxEntry[] = [];
  private readonly log: ScopedLogger;

  constructor(
    @inject(LOCAL_STORE_SERVICE)
    private readonly localStore: LocalStoreService,
    @inject(ENTITY_REGISTRY)
    private readonly registry: EntityRegistry,
    @inject(ROOT_LOGGER)
    rootLogger: RootLogger,
  ) {
    this.log = rootLogger.scope("local-store:outbox");
  }

  list(): OutboxEntry[] {
    return [...this.entries];
  }

  queuedCount(): number {
    return this.entries.filter((e) => e.state === "queued").length;
  }

  async enqueue(input: EnqueueInput): Promise<OutboxEntry> {
    const handle = this.localStore.getHandle();
    if (!handle) {
      throw new Error("Local store is not open; cannot enqueue mutation");
    }
    const entry: NewOutboxEntry = {
      id: globalThis.crypto.randomUUID(),
      collection: input.collection,
      recordId: input.recordId,
      op: input.op,
      payload: input.payload,
      oldValues: input.oldValues,
      state: "queued",
      attempts: 0,
      enqueuedAt: new Date().toISOString(),
      leaseUntil: null,
      lastError: null,
    };
    const stored = await handle.outboxAdd(entry);
    this.entries.push(stored);
    this.events.emit("enqueued", stored);
    return stored;
  }

  /**
   * Boot: load persisted entries, requeue orphaned `executing` ones (their
   * lease died with the previous process), and re-apply pending update
   * payloads onto pools so the UI shows queued writes immediately.
   */
  async replayOntoPools(): Promise<void> {
    const handle = this.localStore.getHandle();
    if (!handle) return;
    const entries = await handle.outboxList();
    for (const entry of entries) {
      if (entry.state === "executing") {
        entry.state = "queued";
        entry.leaseUntil = null;
        await handle.outboxUpdate(entry.id, {
          state: "queued",
          leaseUntil: null,
        });
      }
    }
    this.entries = entries;

    for (const entry of entries) {
      if (entry.state !== "queued" || entry.op !== "update") continue;
      this.overlayOntoPool(entry);
    }
    if (entries.length > 0) {
      this.log.info(`replayed ${entries.length} outbox entrie(s) after boot`);
    }
  }

  /**
   * Merged pending update fields for a record — the rebase overlay pulls
   * consult so background syncs never visually revert a pending local edit.
   */
  pendingOverlay(
    collection: string,
    recordId: string,
  ): Record<string, unknown> | null {
    let overlay: Record<string, unknown> | null = null;
    for (const entry of this.entries) {
      if (
        entry.collection !== collection ||
        entry.recordId !== recordId ||
        entry.op !== "update" ||
        entry.state === "parked"
      ) {
        continue;
      }
      overlay = {
        ...(overlay ?? {}),
        ...(entry.payload as Record<string, unknown>),
      };
    }
    return overlay;
  }

  async markExecuting(entry: OutboxEntry, leaseMs: number): Promise<void> {
    const handle = this.requireHandle();
    entry.state = "executing";
    entry.leaseUntil = new Date(Date.now() + leaseMs).toISOString();
    await handle.outboxUpdate(entry.id, {
      state: "executing",
      leaseUntil: entry.leaseUntil,
    });
  }

  async markQueuedForRetry(entry: OutboxEntry, error: string): Promise<void> {
    const handle = this.requireHandle();
    entry.state = "queued";
    entry.attempts += 1;
    entry.leaseUntil = null;
    entry.lastError = error;
    await handle.outboxUpdate(entry.id, {
      state: "queued",
      attempts: entry.attempts,
      leaseUntil: null,
      lastError: error,
    });
  }

  /** Terminal failure: roll the optimistic change back and park the entry. */
  async park(entry: OutboxEntry, error: string): Promise<void> {
    const handle = this.requireHandle();
    entry.state = "parked";
    entry.lastError = error;
    await handle.outboxUpdate(entry.id, {
      state: "parked",
      lastError: error,
      leaseUntil: null,
    });
    this.rollbackOntoPool(entry);
    this.events.emit("parked", { entry, error });
    this.log.warn(
      `parked ${entry.collection}/${entry.op} for ${entry.recordId}: ${error}`,
    );
  }

  async complete(entry: OutboxEntry): Promise<void> {
    const handle = this.requireHandle();
    await handle.outboxDelete(entry.id);
    this.entries = this.entries.filter((e) => e.id !== entry.id);
    this.events.emit("flushed", entry);
  }

  async discardParked(entryId: string): Promise<void> {
    const handle = this.requireHandle();
    await handle.outboxDelete(entryId);
    this.entries = this.entries.filter((e) => e.id !== entryId);
  }

  /** Oldest queued entry per record, respecting per-record FIFO. */
  nextQueued(): OutboxEntry | null {
    const blockedRecords = new Set<string>();
    for (const entry of this.entries) {
      const recordKey = `${entry.collection}:${entry.recordId}`;
      if (entry.state === "queued" && !blockedRecords.has(recordKey)) {
        return entry;
      }
      // Executing or parked entries block later entries for the same record.
      if (entry.state !== "queued") blockedRecords.add(recordKey);
    }
    return null;
  }

  clearMemory(): void {
    this.entries = [];
  }

  private overlayOntoPool(entry: OutboxEntry): void {
    const pool = this.tryGetPool(entry.collection);
    const current = pool?.get(entry.recordId);
    if (!pool || !current) return;
    pool.applyUpserts(
      [{ ...current, ...(entry.payload as Record<string, unknown>) }],
      { persist: false },
    );
  }

  private rollbackOntoPool(entry: OutboxEntry): void {
    const pool = this.tryGetPool(entry.collection);
    if (!pool) return;
    if (entry.op === "create") {
      pool.applyDeletes([entry.recordId], { persist: false });
      return;
    }
    const current = pool.get(entry.recordId);
    if (!current) return;
    pool.applyUpserts(
      [{ ...current, ...(entry.oldValues as Record<string, unknown>) }],
      { persist: false },
    );
  }

  private tryGetPool(collection: string) {
    try {
      return this.registry.getPool<SyncedEntity>(collection);
    } catch {
      return null;
    }
  }

  private requireHandle() {
    const handle = this.localStore.getHandle();
    if (!handle) {
      throw new Error("Local store is not open");
    }
    return handle;
  }
}

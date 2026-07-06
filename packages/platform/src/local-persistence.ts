/**
 * Durable local persistence for the local-first store: the write-behind tier
 * beneath the in-memory object pools. Hosts bind an implementation appropriate
 * to their runtime (IndexedDB/Dexie on desktop renderer + web; in-memory fakes
 * in tests). The pool is the read path; this handle is only touched on writes,
 * boot hydration, and lifecycle events.
 *
 * Model rows contain ONLY server-acknowledged state — optimistic values live
 * in memory and in the outbox, never in `records` (keeps rollback trivial and
 * makes the cache always safe to nuke and re-bootstrap).
 */

/** One persisted, server-acknowledged entity row. `data` must be JSON-safe. */
export interface LocalStoreRecord {
  collection: string;
  id: string;
  /** Server-provided last-modified timestamp (ISO-8601), if the entity has one. */
  updatedAt: string | null;
  data: unknown;
}

export type OutboxEntryState = "queued" | "executing" | "parked";

/**
 * One durable pending mutation. Enqueued before the network send so a crash
 * never loses a user write; replayed onto the pools at boot.
 */
export interface OutboxEntry {
  /** Client-generated unique id (uuid). */
  id: string;
  /** Monotonic order assigned by the persistence layer. */
  seq: number;
  collection: string;
  recordId: string;
  /** Domain operation discriminator, e.g. "create" | "update" | "delete". */
  op: string;
  /** JSON-safe forward payload (changed fields for updates). */
  payload: unknown;
  /** JSON-safe inverse data for rollback (and future undo). */
  oldValues: unknown;
  state: OutboxEntryState;
  attempts: number;
  enqueuedAt: string;
  /** Lease expiry (ISO-8601) while `executing`; guards double-flush on leader failover. */
  leaseUntil: string | null;
  /** Terminal error recorded when parked. */
  lastError: string | null;
}

export type NewOutboxEntry = Omit<OutboxEntry, "seq">;

/** Open handle to one namespace's database. */
export interface LocalPersistenceHandle {
  readonly namespace: string;

  getAll(collection: string): Promise<LocalStoreRecord[]>;
  getMany(
    collection: string,
    ids: readonly string[],
  ): Promise<LocalStoreRecord[]>;
  bulkPut(records: readonly LocalStoreRecord[]): Promise<void>;
  bulkDelete(collection: string, ids: readonly string[]): Promise<void>;
  /** Drop every model row in every collection. Never touches meta or outbox. */
  clearRecords(): Promise<void>;

  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
  deleteMeta(key: string): Promise<void>;

  outboxAdd(entry: NewOutboxEntry): Promise<OutboxEntry>;
  /** All entries in seq order. */
  outboxList(): Promise<OutboxEntry[]>;
  outboxUpdate(
    id: string,
    patch: Partial<
      Pick<
        OutboxEntry,
        "state" | "attempts" | "leaseUntil" | "lastError" | "payload"
      >
    >,
  ): Promise<void>;
  outboxDelete(id: string): Promise<void>;

  close(): Promise<void>;
}

export interface LocalPersistence {
  /** Open (creating if absent) the database for a `{user, project}` namespace. */
  open(namespace: string): Promise<LocalPersistenceHandle>;
  /** Permanently delete a namespace's database (logout, identity mismatch). */
  deleteNamespace(namespace: string): Promise<void>;
}

export const LOCAL_PERSISTENCE = Symbol.for(
  "posthog.platform.localPersistence",
);

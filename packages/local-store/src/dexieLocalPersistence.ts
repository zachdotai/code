import type {
  LocalPersistence,
  LocalPersistenceHandle,
  LocalStoreRecord,
  NewOutboxEntry,
  OutboxEntry,
} from "@posthog/platform/local-persistence";
import Dexie, { type Table } from "dexie";

const DB_PREFIX = "posthog-code-localstore";

interface MetaRow {
  key: string;
  value: string;
}

/** Outbox row as stored; `seq` is assigned by Dexie's auto-increment. */
type OutboxRow = Omit<OutboxEntry, "seq"> & { seq?: number };

class LocalStoreDatabase extends Dexie {
  records!: Table<LocalStoreRecord, [string, string]>;
  meta!: Table<MetaRow, string>;
  outbox!: Table<OutboxRow, number>;

  constructor(name: string) {
    super(name);
    // One static schema forever: entity-shape changes are handled by the
    // engine's schemaHash re-bootstrap, never by IndexedDB migrations.
    this.version(1).stores({
      records: "[collection+id], collection",
      meta: "key",
      outbox: "++seq, id, state",
    });
  }
}

function databaseName(namespace: string): string {
  return `${DB_PREFIX}:${namespace}`;
}

class DexieLocalPersistenceHandle implements LocalPersistenceHandle {
  constructor(
    readonly namespace: string,
    private readonly db: LocalStoreDatabase,
  ) {}

  getAll(collection: string): Promise<LocalStoreRecord[]> {
    return this.db.records.where("collection").equals(collection).toArray();
  }

  async getMany(
    collection: string,
    ids: readonly string[],
  ): Promise<LocalStoreRecord[]> {
    const keys = ids.map((id) => [collection, id] as [string, string]);
    const rows = await this.db.records.bulkGet(keys);
    return rows.filter((row): row is LocalStoreRecord => row !== undefined);
  }

  async bulkPut(records: readonly LocalStoreRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.db.records.bulkPut(records as LocalStoreRecord[]);
  }

  async bulkDelete(collection: string, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const keys = ids.map((id) => [collection, id] as [string, string]);
    await this.db.records.bulkDelete(keys);
  }

  async clearRecords(): Promise<void> {
    await this.db.records.clear();
  }

  async getMeta(key: string): Promise<string | null> {
    const row = await this.db.meta.get(key);
    return row?.value ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.db.meta.put({ key, value });
  }

  async deleteMeta(key: string): Promise<void> {
    await this.db.meta.delete(key);
  }

  async outboxAdd(entry: NewOutboxEntry): Promise<OutboxEntry> {
    const seq = await this.db.outbox.add({ ...entry });
    return { ...entry, seq: seq as number };
  }

  async outboxList(): Promise<OutboxEntry[]> {
    const rows = await this.db.outbox.orderBy("seq").toArray();
    return rows as OutboxEntry[];
  }

  async outboxUpdate(
    id: string,
    patch: Partial<
      Pick<
        OutboxEntry,
        "state" | "attempts" | "leaseUntil" | "lastError" | "payload"
      >
    >,
  ): Promise<void> {
    await this.db.outbox.where("id").equals(id).modify(patch);
  }

  async outboxDelete(id: string): Promise<void> {
    await this.db.outbox.where("id").equals(id).delete();
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

export class DexieLocalPersistence implements LocalPersistence {
  async open(namespace: string): Promise<LocalPersistenceHandle> {
    const db = new LocalStoreDatabase(databaseName(namespace));
    await db.open();
    return new DexieLocalPersistenceHandle(namespace, db);
  }

  async deleteNamespace(namespace: string): Promise<void> {
    await Dexie.delete(databaseName(namespace));
  }
}

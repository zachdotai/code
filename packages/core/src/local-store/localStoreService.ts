import {
  ROOT_LOGGER,
  type RootLogger,
  type ScopedLogger,
} from "@posthog/di/logger";
import {
  LOCAL_PERSISTENCE,
  type LocalPersistence,
  type LocalPersistenceHandle,
} from "@posthog/platform/local-persistence";
import { inject, injectable } from "inversify";
import type { EntityRegistry } from "./entityRegistry";
import { ENTITY_REGISTRY, PERSISTER } from "./identifiers";
import type { Persister } from "./persister";
import type { EntityPool } from "./poolStore";
import {
  buildNamespace,
  type EntityDefinition,
  type LocalStoreNamespaceInput,
  META_SCHEMA_HASH,
  type SyncedEntity,
} from "./schemas";

export interface OpenResult {
  namespace: string;
  /**
   * True when the cache was empty or its schemaHash mismatched (model tables
   * were nuked). The sync engine must run a full bootstrap for every
   * collection before trusting local reads.
   */
  bootstrapRequired: boolean;
}

/**
 * Lifecycle owner of the local-first store for one identity namespace:
 * opens the database, enforces the schemaHash re-bootstrap contract, hydrates
 * eager pools before first render, and attaches write-behind persistence.
 */
@injectable()
export class LocalStoreService {
  private handle: LocalPersistenceHandle | null = null;
  private currentNamespace: string | null = null;
  private readonly log: ScopedLogger;

  constructor(
    @inject(LOCAL_PERSISTENCE)
    private readonly persistence: LocalPersistence,
    @inject(ENTITY_REGISTRY)
    private readonly registry: EntityRegistry,
    @inject(PERSISTER)
    private readonly persister: Persister,
    @inject(ROOT_LOGGER)
    rootLogger: RootLogger,
  ) {
    this.log = rootLogger.scope("local-store");
  }

  get namespace(): string | null {
    return this.currentNamespace;
  }

  /** Engine internals (outbox, sync cursors) share the open handle. */
  getHandle(): LocalPersistenceHandle | null {
    return this.handle;
  }

  async open(input: LocalStoreNamespaceInput): Promise<OpenResult> {
    const namespace = buildNamespace(input);
    if (this.currentNamespace === namespace && this.handle) {
      return { namespace, bootstrapRequired: false };
    }
    await this.close();
    this.registry.clearAllPools();

    const handle = await this.persistence.open(namespace);
    const expectedHash = this.registry.schemaHash();
    const storedHash = await handle.getMeta(META_SCHEMA_HASH);
    const bootstrapRequired = storedHash !== expectedHash;

    if (bootstrapRequired) {
      if (storedHash !== null) {
        this.log.info(
          `schemaHash changed (${storedHash} → ${expectedHash}); nuking model tables for re-bootstrap`,
        );
      }
      // Cache data is never migrated — drop and re-bootstrap from the server.
      // The outbox is deliberately untouched.
      await handle.clearRecords();
      await handle.setMeta(META_SCHEMA_HASH, expectedHash);
    }

    for (const { definition, pool } of this.registry.all()) {
      if (definition.hydration !== "eager") continue;
      await this.hydratePool(handle, definition, pool);
    }

    this.persister.attach(handle);
    this.handle = handle;
    this.currentNamespace = namespace;
    this.log.info(
      `opened namespace ${namespace} (bootstrapRequired=${bootstrapRequired})`,
    );
    return { namespace, bootstrapRequired };
  }

  /** Hydrate a lazy collection on demand (e.g. opening a transcript). */
  async hydrateCollection(name: string): Promise<void> {
    const handle = this.handle;
    if (!handle) {
      throw new Error("Local store is not open");
    }
    const definition = this.registry.getDefinition(name);
    if (!definition) {
      throw new Error(`Unknown entity collection "${name}"`);
    }
    const pool = this.registry.getPool(name);
    if (pool.store.getState().hydrated) return;
    await this.hydratePool(handle, definition, pool);
  }

  async close(): Promise<void> {
    if (!this.handle) return;
    await this.persister.detach();
    await this.handle.close();
    this.handle = null;
    this.currentNamespace = null;
  }

  /**
   * Permanently delete a namespace's database (logout, identity mismatch,
   * account switch) and wipe in-memory pools.
   */
  async wipeNamespace(input: LocalStoreNamespaceInput): Promise<void> {
    const namespace = buildNamespace(input);
    if (this.currentNamespace === namespace) {
      await this.close();
    }
    await this.persistence.deleteNamespace(namespace);
    this.registry.clearAllPools();
    this.log.info(`wiped namespace ${namespace}`);
  }

  private async hydratePool(
    handle: LocalPersistenceHandle,
    definition: EntityDefinition,
    pool: EntityPool<SyncedEntity>,
  ): Promise<void> {
    const rows = await handle.getAll(definition.name);
    const valid: SyncedEntity[] = [];
    let dropped = 0;
    for (const row of rows) {
      const parsed = definition.schema.safeParse(row.data);
      if (parsed.success) {
        valid.push(parsed.data);
      } else {
        dropped += 1;
      }
    }
    if (dropped > 0) {
      this.log.warn(
        `dropped ${dropped} invalid persisted row(s) while hydrating "${definition.name}"`,
      );
    }
    pool.replaceAll(valid);
    pool.markHydrated();
  }
}

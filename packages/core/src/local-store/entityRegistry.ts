import { injectable } from "inversify";
import { createEntityPool, type EntityPool } from "./poolStore";
import {
  computeSchemaHash,
  type EntityDefinition,
  type SyncedEntity,
} from "./schemas";

export interface RegisteredEntity<T extends SyncedEntity = SyncedEntity> {
  definition: EntityDefinition<T>;
  pool: EntityPool<T>;
}

/**
 * Registry of every synced collection: its definition (schema, version,
 * hydration strategy) and its in-memory pool. Feature modules register their
 * entities at module-load time; the engine iterates the registry for
 * hydration, persistence, and (later) sync.
 */
@injectable()
export class EntityRegistry {
  private readonly entities = new Map<string, RegisteredEntity>();

  register<T extends SyncedEntity>(
    definition: EntityDefinition<T>,
  ): EntityPool<T> {
    const existing = this.entities.get(definition.name);
    if (existing) {
      if (existing.definition.version !== definition.version) {
        throw new Error(
          `Entity "${definition.name}" registered twice with different versions (${existing.definition.version} vs ${definition.version})`,
        );
      }
      return existing.pool as unknown as EntityPool<T>;
    }
    const pool = createEntityPool<T>(definition.name);
    this.entities.set(definition.name, {
      definition: definition as unknown as EntityDefinition,
      pool: pool as unknown as EntityPool<SyncedEntity>,
    });
    return pool;
  }

  getDefinition(name: string): EntityDefinition | undefined {
    return this.entities.get(name)?.definition;
  }

  getPool<T extends SyncedEntity>(name: string): EntityPool<T> {
    const entry = this.entities.get(name);
    if (!entry) {
      throw new Error(`Unknown entity collection "${name}"`);
    }
    return entry.pool as unknown as EntityPool<T>;
  }

  all(): RegisteredEntity[] {
    return [...this.entities.values()];
  }

  schemaHash(): string {
    return computeSchemaHash(
      this.all().map(({ definition }) => ({
        name: definition.name,
        version: definition.version,
      })),
    );
  }

  /** Wipe every pool's in-memory state (logout / namespace switch). */
  clearAllPools(): void {
    for (const { pool } of this.entities.values()) {
      pool.clear();
    }
  }
}

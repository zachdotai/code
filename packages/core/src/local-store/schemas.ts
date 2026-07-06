import { z } from "zod";

/**
 * Bump when the engine's persisted layout semantics change (record envelope,
 * meta keys, outbox shape interpretation). Participates in the schema hash, so
 * a bump forces a re-bootstrap on every client.
 */
export const ENGINE_VERSION = 1;

/** Meta keys owned by the engine. Collection cursors use `cursor:<name>`. */
export const META_SCHEMA_HASH = "schemaHash";

/** Every synced entity is identified by a string id. */
export interface SyncedEntity {
  id: string;
}

export type HydrationStrategy = "eager" | "lazy";

export interface EntityDefinition<T extends SyncedEntity = SyncedEntity> {
  /** Collection name — stable, used as the persistence key and pool id. */
  name: string;
  /**
   * Persisted-shape version. Bump on ANY change to the stored shape; the
   * schema hash changes and every client nukes + re-bootstraps this cache.
   * Cache data is never migrated (server truth regenerates it).
   */
  version: number;
  /** Runtime boundary validation for rows leaving persistence or the network. */
  schema: z.ZodType<T>;
  /** Eager collections hydrate into pools before first render; lazy on demand. */
  hydration: HydrationStrategy;
  /**
   * Server-provided last-modified timestamp used for LWW compares and
   * persistence metadata. Defaults to reading `updated_at`.
   */
  getUpdatedAt?: (entity: T) => string | null;
}

/** Identity helper for definition inference at call sites. */
export function defineEntity<T extends SyncedEntity>(
  definition: EntityDefinition<T>,
): EntityDefinition<T> {
  return definition;
}

export function entityUpdatedAt<T extends SyncedEntity>(
  definition: EntityDefinition<T>,
  entity: T,
): string | null {
  if (definition.getUpdatedAt) return definition.getUpdatedAt(entity);
  const value = (entity as Record<string, unknown>).updated_at;
  return typeof value === "string" ? value : null;
}

/**
 * Deterministic FNV-1a hash over the engine version and every registered
 * entity's `name:version`. Any drift ⇒ the local cache is treated as a
 * different schema and rebuilt from the server.
 */
export function computeSchemaHash(
  definitions: ReadonlyArray<Pick<EntityDefinition, "name" | "version">>,
): string {
  const canonical = [
    `engine:${ENGINE_VERSION}`,
    ...definitions
      .map((d) => `${d.name}:${d.version}`)
      .sort((a, b) => a.localeCompare(b)),
  ].join("|");

  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * The local store is namespaced per identity scope: one database per
 * user + project so logout/scope switches swap databases wholesale and can
 * never mix records across identities.
 */
export const localStoreNamespaceSchema = z.object({
  userId: z.union([z.string(), z.number()]).transform((v) => String(v)),
  projectId: z.union([z.string(), z.number()]).transform((v) => String(v)),
});

export type LocalStoreNamespaceInput = z.input<
  typeof localStoreNamespaceSchema
>;

export function buildNamespace(input: LocalStoreNamespaceInput): string {
  const { userId, projectId } = localStoreNamespaceSchema.parse(input);
  return `u${userId}:p${projectId}`;
}

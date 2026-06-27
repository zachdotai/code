import type {
  Persister,
  PersistQueryClientOptions,
} from "@tanstack/react-query-persist-client";

// Only the fields the predicate reads. Declared structurally (rather than
// importing `Query`) so the predicate stays assignable to `shouldDehydrateQuery`
// without coupling to query-core's exact `Query` type.
type PersistableQuery = {
  queryKey: readonly unknown[];
  state: { status: string };
};

// How long a persisted entry stays restorable. Must be <= the queries' gcTime,
// or PersistQueryClientProvider drops the entry on restore. 24h survives normal
// restart cadence while letting very stale canvas data eventually expire.
export const CANVAS_PERSIST_MAX_AGE = 1000 * 60 * 60 * 24;

// Bumped only when the persisted shape changes; a mismatch discards the whole
// on-disk blob on restore. NOT the auth identity: the auth store is anonymous at
// mount (it resolves async), so an identity buster would never match on a cold
// reload and restore would never fire. Cross-project isolation is handled by
// wiping the blob on logout/project-switch instead (see removePersistedCache).
export const CANVAS_PERSIST_BUSTER = "canvas-v1";

// Storage key for the on-disk query cache (one blob, shared by both hosts).
export const CANVAS_PERSIST_KEY = "posthog-code:rq-canvas-cache";

/**
 * Persist ONLY the canvas surface's queries, matched by query key, and only once
 * they've succeeded. An explicit allowlist keeps sessions, auth, current-user,
 * and agent chat off disk, so the blob stays small and carries no secrets.
 */
export function shouldPersistCanvasQuery(query: PersistableQuery): boolean {
  if (query.state.status !== "success") return false;
  const key = query.queryKey;
  if (!Array.isArray(key)) return false;
  // useChannels uses a plain key: ["canvas-channels"].
  if (key[0] === "canvas-channels") return true;
  // tRPC keys are shaped [[router, procedure], { input, type }].
  const path = key[0];
  if (Array.isArray(path)) {
    const [routerName, procedure] = path as string[];
    if (routerName === "dashboards") {
      return procedure === "list" || procedure === "get";
    }
    if (routerName === "channelTasks") return procedure === "list";
  }
  return false;
}

// The active persister, registered when a host builds its persist options. Lets
// removePersistedCache() wipe the on-disk blob without the auth layer needing to
// know which host's persister is in play.
let activePersister: Persister | null = null;

/**
 * Wipe the on-disk query cache. Called on logout and project switch (via
 * clearAuthScopedQueries) so persisted, project-scoped canvas data never
 * outlives the session that wrote it.
 */
export async function removePersistedCache(): Promise<void> {
  await activePersister?.removeClient();
}

/**
 * Build the PersistQueryClientProvider options for a host's persister, and
 * register it so removePersistedCache() can reach it. Both hosts share the same
 * predicate, maxAge, and buster.
 */
export function buildCanvasPersistOptions(
  persister: Persister,
): Omit<PersistQueryClientOptions, "queryClient"> {
  activePersister = persister;
  return {
    persister,
    maxAge: CANVAS_PERSIST_MAX_AGE,
    buster: CANVAS_PERSIST_BUSTER,
    dehydrateOptions: { shouldDehydrateQuery: shouldPersistCanvasQuery },
  };
}

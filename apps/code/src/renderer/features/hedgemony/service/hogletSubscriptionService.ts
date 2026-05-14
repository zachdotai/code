import { getAuthenticatedClient } from "@features/auth/hooks/authClient";
import type { HogletWatchEvent } from "@main/services/hedgemony/schemas";
import { trpcClient } from "@renderer/trpc/client";
import { logger } from "@utils/logger";
import { useHogletPositionStore } from "../stores/hogletPositionStore";
import { useHogletStore, WILD_BUCKET } from "../stores/hogletStore";
import { wildHogletPosition } from "../utils/hogletPositions";

const log = logger.scope("hoglet-subscription-service");

const TASK_SUMMARY_REFRESH_MS = 10_000;

type WatchHandle = { unsubscribe: () => void };

function resolveHogletPosition(hogletId: string): { x: number; y: number } {
  const override = useHogletPositionStore.getState().positions[hogletId];
  if (override) return override;
  return wildHogletPosition(hogletId);
}

function applyWatchEvent(bucket: string, event: HogletWatchEvent): void {
  const store = useHogletStore.getState();
  if (event.kind === "upsert") {
    store.upsert(bucket, event.hoglet);
  } else {
    const pos = resolveHogletPosition(event.hogletId);
    store.startDying(event.hogletId, pos.x, pos.y);
    store.remove(bucket, event.hogletId);
  }
}

async function refreshTaskSummaries(taskIds: string[]): Promise<void> {
  if (taskIds.length === 0) return;
  const client = await getAuthenticatedClient();
  if (!client) return;
  try {
    const summaries = await client.getTaskSummaries(taskIds);
    useHogletStore.getState().setTaskSummaries(summaries);
  } catch (error) {
    log.error("Failed to fetch task summaries", { error });
  }
}

/**
 * Refcounted shared poll loop that walks every bucket in the store and
 * refreshes task summaries in one batched call. Each bucket initializer
 * acquires on start and releases on dispose; the interval clears when the
 * refcount returns to zero.
 */
let pollHandle: ReturnType<typeof setInterval> | null = null;
let pollRefCount = 0;

function pollAllSummaries(): void {
  const { byBucket } = useHogletStore.getState();
  const taskIds = new Set<string>();
  for (const bucket of Object.values(byBucket)) {
    for (const h of bucket) taskIds.add(h.taskId);
  }
  if (taskIds.size === 0) return;
  void refreshTaskSummaries([...taskIds]);
}

function acquireTaskSummaryPolling(): void {
  pollRefCount += 1;
  if (pollRefCount === 1 && !pollHandle) {
    pollHandle = setInterval(pollAllSummaries, TASK_SUMMARY_REFRESH_MS);
  }
}

function releaseTaskSummaryPolling(): void {
  pollRefCount = Math.max(0, pollRefCount - 1);
  if (pollRefCount === 0 && pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}

/**
 * Bootstraps the wild hoglet bucket: fetches the current list, opens a watch
 * subscription, and registers with the shared task-summary poll. Returns a
 * disposer that tears everything down.
 */
export function initializeWildHogletStore(): () => void {
  let disposed = false;
  acquireTaskSummaryPolling();

  const watch: WatchHandle = trpcClient.hedgemony.hoglets.watch.subscribe(
    { kind: "wild" },
    {
      onData: (event) => applyWatchEvent(WILD_BUCKET, event),
      onError: (error) =>
        log.error("wild hoglet watch subscription error", { error }),
    },
  );

  trpcClient.hedgemony.hoglets.list
    .query({ wildOnly: true })
    .then((hoglets) => {
      if (disposed) return;
      useHogletStore.getState().setBucket(WILD_BUCKET, hoglets);
      pollAllSummaries();
    })
    .catch((error) => log.error("Failed to load wild hoglets", { error }));

  return () => {
    if (disposed) return;
    disposed = true;
    watch.unsubscribe();
    releaseTaskSummaryPolling();
  };
}

/**
 * Bootstraps a per-nest hoglet bucket. Mirrors initializeWildHogletStore but
 * scoped to a single nest; subscribes to nest-scoped watch events and seeds
 * the bucket from `hoglets.list({ nestId })`.
 */
export function initializeNestHogletStore(nestId: string): () => void {
  let disposed = false;
  acquireTaskSummaryPolling();

  const watch: WatchHandle = trpcClient.hedgemony.hoglets.watch.subscribe(
    { kind: "nest", nestId },
    {
      onData: (event) => applyWatchEvent(nestId, event),
      onError: (error) =>
        log.error("nest hoglet watch subscription error", { nestId, error }),
    },
  );

  trpcClient.hedgemony.hoglets.list
    .query({ nestId })
    .then((hoglets) => {
      if (disposed) return;
      useHogletStore.getState().setBucket(nestId, hoglets);
      pollAllSummaries();
    })
    .catch((error) =>
      log.error("Failed to load nest hoglets", { nestId, error }),
    );

  return () => {
    if (disposed) return;
    disposed = true;
    watch.unsubscribe();
    releaseTaskSummaryPolling();
  };
}

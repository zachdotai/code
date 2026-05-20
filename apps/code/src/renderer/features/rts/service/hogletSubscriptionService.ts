import { getAuthenticatedClient } from "@features/auth/hooks/authClient";
import type { Hoglet, HogletWatchEvent } from "@main/services/rts/schemas";
import { logger } from "@utils/logger";
import { trpcHogletRemoteService } from "../adapters/trpcHogletRemoteService";
import { zustandHogletPositionRepository } from "../adapters/zustandHogletPositionRepository";
import { zustandHogletRepository } from "../adapters/zustandHogletRepository";
import { RTS_CONFIG } from "../config";
import { WILD_BUCKET } from "../constants/buckets";
import type { HogletPositionRepository } from "../domain/HogletPositionRepository";
import type { HogletRemoteService } from "../domain/HogletRemoteService";
import type { HogletRepository } from "../domain/HogletRepository";
import type { WatchHandle } from "../domain/NestRemoteService";
import { wildHogletPosition } from "../utils/hogletPositions";
import { getHogletVisualPosition } from "../utils/hogletVisualPositions";

const log = logger.scope("hoglet-subscription-service");

const TASK_SUMMARY_REFRESH_MS = RTS_CONFIG.polling.taskSummaryMs;

export interface HogletSubscriptionDeps {
  hoglets: HogletRepository;
  positions: HogletPositionRepository;
  remote: HogletRemoteService;
}

export const defaultHogletSubscriptionDeps: HogletSubscriptionDeps = {
  hoglets: zustandHogletRepository,
  positions: zustandHogletPositionRepository,
  remote: trpcHogletRemoteService,
};

function resolveHogletPosition(
  hogletId: string,
  positions: HogletPositionRepository,
): { x: number; y: number } {
  // Prefer the live sprite position so death animations land where the hoglet
  // is actually rendered — the position store holds the walk *destination*,
  // which diverges from the visible sprite while a walk is in flight.
  const visual = getHogletVisualPosition(hogletId);
  if (visual) return visual;
  const override = positions.getPosition(hogletId);
  if (override) return override;
  return wildHogletPosition(hogletId);
}

function applyWatchEvent(
  bucket: string,
  event: HogletWatchEvent,
  deps: HogletSubscriptionDeps,
): void {
  if (event.kind === "upsert") {
    deps.hoglets.upsert(bucket, event.hoglet);
    // A roster change often means the main process just observed a fresh run
    // state. Refresh now so sprites and detail panels don't wait on polling.
    void refreshTaskSummaries([event.hoglet.taskId], deps.hoglets);
  } else {
    const pos = resolveHogletPosition(event.hogletId, deps.positions);
    deps.hoglets.startDying(event.hogletId, pos.x, pos.y);
    deps.hoglets.remove(bucket, event.hogletId);
  }
}

async function refreshTaskSummaries(
  taskIds: string[],
  hoglets: HogletRepository,
): Promise<void> {
  if (taskIds.length === 0) return;
  const client = await getAuthenticatedClient();
  if (!client) return;
  try {
    const summaries = await client.getTaskSummaries(taskIds);
    hoglets.setTaskSummaries(summaries);
  } catch (error) {
    log.error("Failed to fetch task summaries", { error });
  }
}

/**
 * Refcounted shared poll loop that walks every bucket in the repo and
 * refreshes task summaries in one batched call. Each bucket initializer
 * acquires on start and releases on dispose; the interval clears when the
 * refcount returns to zero.
 */
let pollHandle: ReturnType<typeof setInterval> | null = null;
let pollRefCount = 0;

function pollAllSummaries(hoglets: HogletRepository): void {
  const taskIds = hoglets.collectTaskIds();
  if (taskIds.length === 0) return;
  void refreshTaskSummaries(taskIds, hoglets);
}

function acquireTaskSummaryPolling(hoglets: HogletRepository): void {
  pollRefCount += 1;
  if (pollRefCount === 1 && !pollHandle) {
    pollHandle = setInterval(
      () => pollAllSummaries(hoglets),
      TASK_SUMMARY_REFRESH_MS,
    );
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
export function initializeWildHogletStore(
  deps: HogletSubscriptionDeps = defaultHogletSubscriptionDeps,
): () => void {
  return initializeHogletBucket(
    {
      bucket: WILD_BUCKET,
      subscribe: (handlers) => deps.remote.watch({ kind: "wild" }, handlers),
      list: () => deps.remote.list({ wildOnly: true }),
      logContext: { kind: "wild" },
    },
    deps,
  );
}

/**
 * Bootstraps a per-nest hoglet bucket. Mirrors initializeWildHogletStore but
 * scoped to a single nest; subscribes to nest-scoped watch events and seeds
 * the bucket from `hoglets.list({ nestId })`.
 */
export function initializeNestHogletStore(
  nestId: string,
  deps: HogletSubscriptionDeps = defaultHogletSubscriptionDeps,
): () => void {
  return initializeHogletBucket(
    {
      bucket: nestId,
      subscribe: (handlers) =>
        deps.remote.watch({ kind: "nest", nestId }, handlers),
      list: () => deps.remote.list({ nestId }),
      logContext: { kind: "nest", nestId },
    },
    deps,
  );
}

interface InitializeHogletBucketOptions {
  bucket: string;
  subscribe: (handlers: {
    onData: (event: HogletWatchEvent) => void;
    onError: (error: unknown) => void;
  }) => WatchHandle;
  list: () => Promise<Hoglet[]>;
  logContext: Record<string, unknown>;
}

/**
 * Shared bootstrap that closes the watch-before-load race: incoming watch
 * events are buffered until the initial list resolves, then replayed against
 * the freshly-seeded bucket. Any subsequent event applies directly.
 */
function initializeHogletBucket(
  opts: InitializeHogletBucketOptions,
  deps: HogletSubscriptionDeps,
): () => void {
  let disposed = false;
  let initialLoaded = false;
  const buffered: HogletWatchEvent[] = [];
  acquireTaskSummaryPolling(deps.hoglets);

  const watch = opts.subscribe({
    onData: (event) => {
      if (disposed) return;
      if (!initialLoaded) {
        buffered.push(event);
        return;
      }
      applyWatchEvent(opts.bucket, event, deps);
    },
    onError: (error) =>
      log.error("hoglet watch subscription error", {
        ...opts.logContext,
        error,
      }),
  });

  opts
    .list()
    .then((hoglets) => {
      if (disposed) return;
      deps.hoglets.setBucket(opts.bucket, hoglets);
      // Replay any events that arrived between subscribe and list-resolve so
      // upserts/deletions don't get clobbered by the initial seed.
      for (const event of buffered) applyWatchEvent(opts.bucket, event, deps);
      buffered.length = 0;
      initialLoaded = true;
      pollAllSummaries(deps.hoglets);
    })
    .catch((error) =>
      log.error("Failed to load hoglets", { ...opts.logContext, error }),
    );

  return () => {
    if (disposed) return;
    disposed = true;
    watch.unsubscribe();
    releaseTaskSummaryPolling();
  };
}

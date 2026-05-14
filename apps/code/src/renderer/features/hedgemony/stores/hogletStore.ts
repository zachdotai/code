import { getAuthenticatedClient } from "@features/auth/hooks/authClient";
import type {
  Hoglet,
  HogletWatchEvent,
} from "@main/services/hedgemony/schemas";
import type { Schemas } from "@renderer/api/generated";
import { trpcClient } from "@renderer/trpc/client";
import { logger } from "@utils/logger";
import { create } from "zustand";

const log = logger.scope("hoglet-store");

export const WILD_BUCKET = "wild";

const TASK_SUMMARY_REFRESH_MS = 10_000;

interface HogletStoreState {
  byBucket: Record<string, Hoglet[]>;
  taskSummaries: Record<string, Schemas.TaskSummary>;
  loaded: Record<string, boolean>;
}

interface HogletStoreActions {
  setBucket: (bucket: string, hoglets: Hoglet[]) => void;
  upsert: (bucket: string, hoglet: Hoglet) => void;
  remove: (bucket: string, hogletId: string) => void;
  setTaskSummaries: (summaries: Schemas.TaskSummary[]) => void;
  reset: () => void;
}

type HogletStore = HogletStoreState & HogletStoreActions;

const initialState: HogletStoreState = {
  byBucket: {},
  taskSummaries: {},
  loaded: {},
};

export const useHogletStore = create<HogletStore>()((set) => ({
  ...initialState,

  setBucket: (bucket, hoglets) =>
    set((state) => ({
      byBucket: { ...state.byBucket, [bucket]: hoglets },
      loaded: { ...state.loaded, [bucket]: true },
    })),

  upsert: (bucket, hoglet) =>
    set((state) => {
      const current = state.byBucket[bucket] ?? [];
      const without = current.filter((h) => h.id !== hoglet.id);
      return {
        byBucket: { ...state.byBucket, [bucket]: [...without, hoglet] },
      };
    }),

  remove: (bucket, hogletId) =>
    set((state) => {
      const current = state.byBucket[bucket];
      if (!current) return state;
      return {
        byBucket: {
          ...state.byBucket,
          [bucket]: current.filter((h) => h.id !== hogletId),
        },
      };
    }),

  setTaskSummaries: (summaries) =>
    set((state) => {
      const next = { ...state.taskSummaries };
      for (const s of summaries) next[s.id] = s;
      return { taskSummaries: next };
    }),

  reset: () => set(initialState),
}));

export const selectWildHoglets = (state: HogletStore): Hoglet[] =>
  state.byBucket[WILD_BUCKET] ?? [];

export const selectWildLoaded = (state: HogletStore): boolean =>
  state.loaded[WILD_BUCKET] ?? false;

export const selectTaskSummary =
  (taskId: string) =>
  (state: HogletStore): Schemas.TaskSummary | null =>
    state.taskSummaries[taskId] ?? null;

type WatchHandle = { unsubscribe: () => void };

function applyWatchEvent(bucket: string, event: HogletWatchEvent): void {
  const store = useHogletStore.getState();
  if (event.kind === "upsert") store.upsert(bucket, event.hoglet);
  else store.remove(bucket, event.hogletId);
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
 * Bootstraps the wild hoglet bucket: fetches the current list, opens a watch
 * subscription, and starts a coarse polling loop for the underlying Task
 * summaries (since SSE-driven Task state isn't wired here yet). Returns a
 * disposer that tears everything down.
 */
export function initializeWildHogletStore(): () => void {
  let disposed = false;
  let watch: WatchHandle | null = null;
  let pollHandle: ReturnType<typeof setInterval> | null = null;

  watch = trpcClient.hedgemony.hoglets.watch.subscribe(
    { kind: "wild" },
    {
      onData: (event) => applyWatchEvent(WILD_BUCKET, event),
      onError: (error) =>
        log.error("wild hoglet watch subscription error", { error }),
    },
  );

  const pollSummaries = () => {
    if (disposed) return;
    const wild = useHogletStore.getState().byBucket[WILD_BUCKET] ?? [];
    const ids = wild.map((h) => h.taskId);
    void refreshTaskSummaries(ids);
  };

  trpcClient.hedgemony.hoglets.list
    .query({ wildOnly: true })
    .then((hoglets) => {
      if (disposed) return;
      useHogletStore.getState().setBucket(WILD_BUCKET, hoglets);
      pollSummaries();
    })
    .catch((error) => log.error("Failed to load wild hoglets", { error }));

  pollHandle = setInterval(pollSummaries, TASK_SUMMARY_REFRESH_MS);

  return () => {
    disposed = true;
    if (watch) watch.unsubscribe();
    if (pollHandle) clearInterval(pollHandle);
  };
}

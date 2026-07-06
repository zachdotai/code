import type { Schemas } from "@posthog/api-client";
import type { EntityRegistry } from "@posthog/core/local-store/entityRegistry";
import {
  defineEntity,
  type SyncedEntity,
} from "@posthog/core/local-store/schemas";
import type {
  DeltaSource,
  PulledWindow,
} from "@posthog/core/local-store/sync/deltaSource";
import type { CloudClientProvider } from "@posthog/core/local-store/sync/identifiers";
import type { Task } from "@posthog/shared/domain-types";
import { z } from "zod";
import { createStore } from "zustand/vanilla";

export const TASKS_COLLECTION = "tasks";
export const TASK_SUMMARIES_COLLECTION = "task_summaries";
export const CHANNEL_FEEDS_COLLECTION = "channel_feeds";
export const TASK_PR_STATUS_COLLECTION = "task_pr_status";

/** Cloud task lists were polled every 30s by three hooks; one source now. */
const TASKS_PULL_INTERVAL_MS = 30_000;
/** Feeds are multiplayer: pull faster while a channel is on screen. */
const TASKS_WITH_CHANNELS_INTERVAL_MS = 10_000;
const PR_STATUS_INTERVAL_MS = 60_000;
const TASKS_PAGE_LIMIT = 500;

/**
 * Boundary validation is deliberately loose: we assert only the fields the
 * app's selectors and LWW depend on and pass everything else through, so a
 * server adding fields never drops rows client-side.
 */
export const taskEntitySchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  repository: z.string().nullish(),
  origin_product: z.string().nullish(),
  internal: z.boolean().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  created_by: z.looseObject({ id: z.number() }).nullish(),
});

export const taskSummaryEntitySchema = z.looseObject({
  id: z.string(),
  title: z.string().nullish(),
  updated_at: z.string().nullish(),
});

/** A synced task row: everything the server sent, id/updated_at guaranteed. */
export type SyncedTask = SyncedEntity & Task;
export type SyncedTaskSummary = SyncedEntity & Schemas.TaskSummary;

export const tasksEntity = defineEntity<SyncedEntity>({
  name: TASKS_COLLECTION,
  version: 1,
  schema: taskEntitySchema as unknown as z.ZodType<SyncedEntity>,
  hydration: "eager",
});

export const taskSummariesEntity = defineEntity<SyncedEntity>({
  name: TASK_SUMMARIES_COLLECTION,
  version: 1,
  schema: taskSummaryEntitySchema as unknown as z.ZodType<SyncedEntity>,
  hydration: "eager",
});

/** One row per channel: the ordered task-id membership of its feed. */
export const channelFeedEntitySchema = z.looseObject({
  id: z.string(),
  task_ids: z.array(z.string()),
});

export const channelFeedsEntity = defineEntity<SyncedEntity>({
  name: CHANNEL_FEEDS_COLLECTION,
  version: 1,
  schema: channelFeedEntitySchema as unknown as z.ZodType<SyncedEntity>,
  hydration: "eager",
});

/** One row per task: sidebar PR state derived by the host's git services. */
export const taskPrStatusEntitySchema = z.looseObject({
  id: z.string(),
  prState: z.enum(["merged", "open", "draft", "closed"]).nullable(),
  hasDiff: z.boolean(),
});

export const taskPrStatusEntity = defineEntity<SyncedEntity>({
  name: TASK_PR_STATUS_COLLECTION,
  version: 1,
  schema: taskPrStatusEntitySchema as unknown as z.ZodType<SyncedEntity>,
  hydration: "eager",
});

/**
 * Sync-scope configuration set by the UI (sidebar's internal-tasks toggle).
 * Windows and their deletion sweeps derive from this — sweep scope always
 * equals pull scope.
 */
export interface TaskSyncConfig {
  includeInternal: boolean;
  /** Channels with an open feed — each gets its own pull window. */
  activeChannels: string[];
}

export const taskSyncConfigStore = createStore<TaskSyncConfig>(() => ({
  includeInternal: false,
  activeChannels: [],
}));

export function setTaskSyncIncludeInternal(includeInternal: boolean): void {
  taskSyncConfigStore.setState({ includeInternal });
}

export function addActiveChannel(channelId: string): void {
  taskSyncConfigStore.setState((state) =>
    state.activeChannels.includes(channelId)
      ? state
      : { activeChannels: [...state.activeChannels, channelId] },
  );
}

export function removeActiveChannel(channelId: string): void {
  taskSyncConfigStore.setState((state) => ({
    activeChannels: state.activeChannels.filter((id) => id !== channelId),
  }));
}

function isInternalTask(row: SyncedEntity): boolean {
  return (row as { internal?: boolean | null }).internal === true;
}

/**
 * Pulls the project's task list(s). The base window (no filters) covers every
 * non-internal task any user created; it must never sweep internal rows —
 * those belong to the optional internal window, pulled only when the staff
 * toggle is on (rows outside a window's scope are invisible to its sweep, so
 * server semantics of `internal=true` can be superset or subset safely).
 */
export class TasksDeltaSource implements DeltaSource<SyncedEntity> {
  readonly collection = TASKS_COLLECTION;

  constructor(private readonly provider: CloudClientProvider) {}

  get intervalMs(): number {
    return taskSyncConfigStore.getState().activeChannels.length > 0
      ? TASKS_WITH_CHANNELS_INTERVAL_MS
      : TASKS_PULL_INTERVAL_MS;
  }

  async pull(): Promise<PulledWindow<SyncedEntity>[] | null> {
    const client = this.provider.getClient();
    if (!client) return null;

    const windows: PulledWindow<SyncedEntity>[] = [];

    const base = (await client.getTasks({})) as unknown as SyncedEntity[];
    windows.push({
      key: "base",
      rows: base,
      sweep: {
        complete: base.length < TASKS_PAGE_LIMIT,
        matches: (row) => !isInternalTask(row),
      },
    });

    if (taskSyncConfigStore.getState().includeInternal) {
      const internal = (await client.getTasks({
        internal: true,
      })) as unknown as SyncedEntity[];
      windows.push({
        key: "internal",
        rows: internal,
        sweep: {
          complete: internal.length < TASKS_PAGE_LIMIT,
          matches: (row) => isInternalTask(row),
        },
      });
    }

    // Open channel feeds: each channel pull feeds the tasks pool (no sweep —
    // membership, not existence, scopes a channel) plus its membership row.
    for (const channelId of taskSyncConfigStore.getState().activeChannels) {
      const rows = (await client.getTasks({
        channel: channelId,
      })) as unknown as SyncedEntity[];
      windows.push({
        key: `channel:${channelId}`,
        rows,
        sweep: null,
      });
      windows.push({
        key: `channel-feed:${channelId}`,
        collection: CHANNEL_FEEDS_COLLECTION,
        rows: [{ id: channelId, task_ids: rows.map((r) => r.id) }] as never[],
        sweep: null,
      });
    }

    return windows;
  }
}

/** Host-provided batch PR-status fetcher (bound over the host tRPC client). */
export interface TaskPrStatusClient {
  getTaskPrStatuses(
    items: Array<{ taskId: string; cloudPrUrl: string | null }>,
  ): Promise<
    Record<
      string,
      {
        prState: "merged" | "open" | "draft" | "closed" | null;
        hasDiff: boolean;
      }
    >
  >;
}

export const TASK_PR_STATUS_CLIENT = Symbol.for(
  "posthog.core.tasks.taskPrStatusClient",
);

function extractPrUrl(row: SyncedEntity | undefined): string | null {
  const run = (row as { latest_run?: { output?: Record<string, unknown> } })
    ?.latest_run;
  const url = run?.output?.pr_url ?? run?.output?.prUrl;
  return typeof url === "string" ? url : null;
}

/**
 * Batch PR status for every local task in ONE host round-trip per tick —
 * replaces the per-sidebar-row IPC query (N+1). Response scope is exactly the
 * requested task ids, so stale rows sweep away with the tasks they belonged to.
 */
export class TaskPrStatusDeltaSource implements DeltaSource<SyncedEntity> {
  readonly collection = TASK_PR_STATUS_COLLECTION;
  readonly intervalMs = PR_STATUS_INTERVAL_MS;

  constructor(
    private readonly client: TaskPrStatusClient,
    private readonly registry: EntityRegistry,
  ) {}

  async pull(): Promise<PulledWindow<SyncedEntity>[] | null> {
    const tasksPool = this.registry.getPool<SyncedEntity>(TASKS_COLLECTION);
    const summariesPool = this.registry.getPool<SyncedEntity>(
      TASK_SUMMARIES_COLLECTION,
    );
    const items = tasksPool.getAll().map((task) => ({
      taskId: task.id,
      cloudPrUrl:
        extractPrUrl(summariesPool.get(task.id)) ?? extractPrUrl(task),
    }));

    if (items.length === 0) {
      return [
        {
          key: "pr-status",
          rows: [],
          sweep: { complete: true, matches: () => true },
        },
      ];
    }

    const statuses = await this.client.getTaskPrStatuses(items);
    const rows = Object.entries(statuses).map(([taskId, status]) => ({
      id: taskId,
      ...status,
    })) as unknown as SyncedEntity[];

    return [
      {
        key: "pr-status",
        rows,
        sweep: { complete: true, matches: () => true },
      },
    ];
  }
}

/**
 * Pulls run summaries for every task currently in the pool. The request scope
 * is exactly the local task ids, so any local summary absent from the
 * response (task deleted, or its task no longer local) sweeps away — the
 * cascade that keeps summaries from outliving their tasks.
 */
export class TaskSummariesDeltaSource implements DeltaSource<SyncedEntity> {
  readonly collection = TASK_SUMMARIES_COLLECTION;
  readonly intervalMs = TASKS_PULL_INTERVAL_MS;

  constructor(
    private readonly provider: CloudClientProvider,
    private readonly registry: EntityRegistry,
  ) {}

  async pull(): Promise<PulledWindow<SyncedEntity>[] | null> {
    const client = this.provider.getClient();
    if (!client) return null;

    const taskIds = this.registry
      .getPool<SyncedEntity>(TASKS_COLLECTION)
      .store.getState().ids;

    if (taskIds.length === 0) {
      return [
        {
          key: "summaries",
          rows: [],
          sweep: { complete: true, matches: () => true },
        },
      ];
    }

    const rows = (await client.getTaskSummaries(
      taskIds,
    )) as unknown as SyncedEntity[];
    return [
      {
        key: "summaries",
        rows,
        sweep: { complete: true, matches: () => true },
      },
    ];
  }
}

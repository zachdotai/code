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

/** Cloud task lists were polled every 30s by three hooks; one source now. */
const TASKS_PULL_INTERVAL_MS = 30_000;
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

/**
 * Sync-scope configuration set by the UI (sidebar's internal-tasks toggle).
 * Windows and their deletion sweeps derive from this — sweep scope always
 * equals pull scope.
 */
export interface TaskSyncConfig {
  includeInternal: boolean;
}

export const taskSyncConfigStore = createStore<TaskSyncConfig>(() => ({
  includeInternal: false,
}));

export function setTaskSyncIncludeInternal(includeInternal: boolean): void {
  taskSyncConfigStore.setState({ includeInternal });
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
  readonly intervalMs = TASKS_PULL_INTERVAL_MS;

  constructor(private readonly provider: CloudClientProvider) {}

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

    return windows;
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

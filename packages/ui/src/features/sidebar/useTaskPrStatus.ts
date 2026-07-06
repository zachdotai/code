import type { EntityRegistry } from "@posthog/core/local-store/entityRegistry";
import { ENTITY_REGISTRY } from "@posthog/core/local-store/identifiers";
import type { SyncedEntity } from "@posthog/core/local-store/schemas";
import { TASK_PR_STATUS_COLLECTION } from "@posthog/core/tasks/taskSync";
import { useService } from "@posthog/di/react";
import { useMemo } from "react";
import { useStore } from "zustand";

export type SidebarPrState = "merged" | "open" | "draft" | "closed" | null;

export interface TaskPrStatus {
  prState: SidebarPrState;
  hasDiff: boolean;
}

const EMPTY: TaskPrStatus = { prState: null, hasDiff: false };

/**
 * Sidebar PR badge state, read from the local pool. The sync engine fills it
 * with ONE batched host call for every visible task — the old version fired
 * an IPC query per sidebar row.
 */
export function useTaskPrStatus(task: {
  id: string;
  cloudPrUrl?: string | null;
  taskRunEnvironment?: string | null;
}): TaskPrStatus {
  const registry = useService<EntityRegistry>(ENTITY_REGISTRY);
  const pool = useMemo(
    () => registry.getPool<SyncedEntity>(TASK_PR_STATUS_COLLECTION),
    [registry],
  );

  const status = useStore(
    pool.store,
    (state) => state.entities[task.id] as unknown as TaskPrStatus | undefined,
  );

  if (!status || (!status.prState && !status.hasDiff)) return EMPTY;
  return { prState: status.prState, hasDiff: status.hasDiff };
}

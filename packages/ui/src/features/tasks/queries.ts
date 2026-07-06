import type { EntityRegistry } from "@posthog/core/local-store/entityRegistry";
import { ENTITY_REGISTRY } from "@posthog/core/local-store/identifiers";
import { TASKS_COLLECTION } from "@posthog/core/tasks/taskSync";
import { resolveService } from "@posthog/di/container";
import { NotAuthenticatedError } from "@posthog/shared";
import type { Task } from "@posthog/shared/domain-types";
import { getAuthenticatedClient } from "@posthog/ui/features/auth/authClientImperative";
import { AUTH_SCOPED_QUERY_META } from "@posthog/ui/features/auth/useCurrentUser";
import { taskKeys } from "@posthog/ui/features/tasks/taskKeys";
import {
  IMPERATIVE_QUERY_CLIENT,
  type ImperativeQueryClient,
} from "@posthog/ui/shell/queryClient";
import { queryOptions } from "@tanstack/react-query";

// Shared query definition so a route `loader` and the component (useQuery) hit
// the same cache entry. The queryFn resolves the authenticated client
// imperatively, so it works outside React (in loaders) as well as inside
// components.
export function taskDetailQuery(taskId: string) {
  return queryOptions({
    queryKey: taskKeys.detail(taskId),
    queryFn: async (): Promise<Task> => {
      const client = await getAuthenticatedClient();
      if (!client) throw new NotAuthenticatedError();
      return (await client.getTask(taskId)) as unknown as Task;
    },
    meta: AUTH_SCOPED_QUERY_META,
  });
}

// Read a task from the local-first pool without fetching. Lets the
// task-detail route loader resolve synchronously from local data.
export function getCachedTask(taskId: string): Task | undefined {
  try {
    return resolveService<EntityRegistry>(ENTITY_REGISTRY)
      .getPool(TASKS_COLLECTION)
      .get(taskId) as unknown as Task | undefined;
  } catch {
    // Pool not registered yet (pre-boot loader) — fall back to fetching.
    return undefined;
  }
}

// Read the seeded task-detail cache entry (set by openTask) without fetching.
// Resolved lazily so the query client is only touched at navigation time, after
// the host has bound IMPERATIVE_QUERY_CLIENT at boot.
export function getCachedTaskDetail(taskId: string): Task | undefined {
  return resolveService<ImperativeQueryClient>(
    IMPERATIVE_QUERY_CLIENT,
  ).getQueryData<Task>(taskDetailQuery(taskId).queryKey);
}

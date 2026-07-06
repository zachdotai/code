import {
  SESSION_SERVICE,
  type SessionService,
} from "@posthog/core/sessions/sessionService";
import {
  TASK_MUTATION_SERVICE,
  type TaskMutationService,
} from "@posthog/core/tasks/taskMutations";
import { useService } from "@posthog/di/react";
import type { Task } from "@posthog/shared/domain-types";
import { useCallback } from "react";

/**
 * Task updates are local-first: they apply to the pools in the same tick and
 * flush through the durable outbox in the background (rollback + notice on
 * server rejection). No cache invalidation, no await-the-network.
 */
export function useUpdateTask() {
  const mutations = useService<TaskMutationService>(TASK_MUTATION_SERVICE);

  const mutateAsync = useCallback(
    ({ taskId, updates }: { taskId: string; updates: Partial<Task> }) =>
      mutations.updateTask(taskId, updates),
    [mutations],
  );

  return {
    mutate: (args: { taskId: string; updates: Partial<Task> }) =>
      void mutateAsync(args),
    mutateAsync,
    isPending: false,
  };
}

export function useRenameTask() {
  const mutations = useService<TaskMutationService>(TASK_MUTATION_SERVICE);
  const sessionService = useService<SessionService>(SESSION_SERVICE);

  const renameTask = useCallback(
    async ({
      taskId,
      newTitle,
    }: {
      taskId: string;
      currentTitle: string;
      newTitle: string;
    }) => {
      sessionService.updateSessionTaskTitle(taskId, newTitle);
      await mutations.renameTask(taskId, newTitle);
    },
    [mutations, sessionService],
  );

  return {
    renameTask,
    // Renames are optimistic — there is no pending window to disable UI for.
    isPending: false,
  };
}

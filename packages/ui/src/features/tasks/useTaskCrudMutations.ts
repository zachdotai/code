import { SYNC_ENGINE } from "@posthog/core/local-store/sync/identifiers";
import type { SyncEngine } from "@posthog/core/local-store/sync/syncEngine";
import {
  SESSION_SERVICE,
  type SessionService,
} from "@posthog/core/sessions/sessionService";
import {
  TASK_DELETION_SERVICE,
  type TaskDeletionService,
} from "@posthog/core/tasks/taskDeletionService";
import {
  TASK_MUTATION_SERVICE,
  type TaskMutationService,
} from "@posthog/core/tasks/taskMutations";
import { useService } from "@posthog/di/react";
import type { Task } from "@posthog/shared/domain-types";
import { destroyTaskTerminals } from "@posthog/ui/features/terminal/destroyTaskTerminals";
import { useAuthenticatedMutation } from "@posthog/ui/hooks/useAuthenticatedMutation";
import { logger } from "@posthog/ui/shell/logger";
import { useCallback } from "react";

const log = logger.scope("tasks");

// Never throws: the task is already deleted server-side, so a cleanup failure
// must not reject the mutation and roll back the optimistic list removal.
export async function releaseDeletedTaskResources(
  taskId: string,
  sessionService: SessionService,
): Promise<void> {
  try {
    await sessionService.disconnectFromTask(taskId);
  } catch (error) {
    log.error("Failed to disconnect session for deleted task", error);
  }
  try {
    destroyTaskTerminals(taskId);
  } catch (error) {
    log.error("Failed to release terminals for deleted task", error);
  }
}

export function useCreateTask() {
  const mutations = useService<TaskMutationService>(TASK_MUTATION_SERVICE);
  const engine = useService<SyncEngine>(SYNC_ENGINE);

  // Creation flows expect the fresh task to be visible everywhere right away.
  // The pool already has it (applyAcknowledged in the service); a poke pulls
  // anything else the server derived (e.g. its summary row).
  const invalidateTasks = (_newTask?: Task) => {
    engine.pokeAll();
  };

  const mutation = useAuthenticatedMutation(
    (
      _client,
      options: {
        description: string;
        repository?: string;
        github_integration?: number;
        createdFrom?: "cli" | "command-menu";
      },
    ) =>
      mutations.createTask({
        description: options.description,
        repository: options.repository,
        github_integration: options.github_integration,
      }) as Promise<Task>,
  );

  return { ...mutation, invalidateTasks };
}

interface DeleteTaskOptions {
  taskId: string;
  taskTitle: string;
  hasWorktree: boolean;
}

export function useDeleteTask() {
  const deletionService = useService<TaskDeletionService>(
    TASK_DELETION_SERVICE,
  );
  const sessionService = useService<SessionService>(SESSION_SERVICE);
  const mutations = useService<TaskMutationService>(TASK_MUTATION_SERVICE);

  const mutation = useAuthenticatedMutation(async (client, taskId: string) => {
    // Instant list removal; the irreversible cleanup (worktrees, sessions,
    // terminals) still waits for server confirmation.
    const removal = mutations.removeTaskLocally(taskId);
    try {
      const result = await deletionService.deleteTask(client, taskId);
      removal.confirm();
      await releaseDeletedTaskResources(taskId, sessionService);
      return result;
    } catch (error) {
      removal.rollback();
      throw error;
    }
  });

  const deleteWithConfirm = useCallback(
    (options: DeleteTaskOptions) =>
      deletionService.confirmAndDelete(options, mutation.mutateAsync),
    [deletionService, mutation.mutateAsync],
  );

  return { ...mutation, deleteWithConfirm };
}

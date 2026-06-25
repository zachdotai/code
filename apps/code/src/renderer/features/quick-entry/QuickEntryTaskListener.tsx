import type { CreateTaskRequest } from "@main/services/quick-entry/schemas";
import { prepareTaskInput } from "@posthog/core/task-detail/taskInput";
import {
  TASK_SERVICE,
  type TaskService,
} from "@posthog/core/task-detail/taskService";
import { useService } from "@posthog/di/react";
import type { ExecutionMode } from "@posthog/shared/domain-types";
import { useCreateTask } from "@posthog/ui/features/tasks/useTaskCrudMutations";
import { openTask } from "@posthog/ui/router/useOpenTask";
import { useTRPC } from "@renderer/trpc/client";
import { useSubscription } from "@trpc/tanstack-react-query";
import { logger } from "@utils/logger";
import { useCallback } from "react";

const log = logger.scope("quick-entry-listener");

/**
 * Runs in the main window. The quick-entry window collects the prompt and
 * forwards it to the main process, which hides itself, focuses the main
 * window, and emits `onCreateTaskRequested`. We run the actual task-creation
 * here so all renderer-local state (session manager, folder cache, sidebar,
 * navigation) is set up in the right window.
 */
export function QuickEntryTaskListener() {
  const trpcReact = useTRPC();
  const taskService = useService<TaskService>(TASK_SERVICE);
  const { invalidateTasks } = useCreateTask();

  const handleCreateTaskFromQuickEntry = useCallback(
    async (data?: CreateTaskRequest) => {
      if (!data) return;
      try {
        const input = prepareTaskInput(data.content, [], {
          selectedDirectory: data.repoPath,
          selectedRepository: null,
          workspaceMode: data.workspaceMode,
          branch: data.branch,
          adapter: data.adapter,
          model: data.model ?? undefined,
          reasoningLevel: data.reasoningLevel ?? undefined,
          executionMode:
            (data.executionMode as ExecutionMode | null) ?? undefined,
        });

        const result = await taskService.createTask(input, (output) => {
          // Push the new task into the cached list so the sidebar updates
          // immediately, then navigate to it.
          invalidateTasks(output.task);
          void openTask(output.task);
        });

        if (!result.success) {
          log.error("Quick entry task creation failed", {
            failedStep: result.failedStep,
            error: result.error,
          });
        }
      } catch (err) {
        log.error("Quick entry task creation threw", { err });
      }
    },
    [taskService, invalidateTasks],
  );

  useSubscription(
    trpcReact.quickEntry.onCreateTaskRequested.subscriptionOptions(undefined, {
      onData: handleCreateTaskFromQuickEntry,
    }),
  );

  return null;
}

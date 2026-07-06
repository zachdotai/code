import type { EntityRegistry } from "@posthog/core/local-store/entityRegistry";
import { ENTITY_REGISTRY } from "@posthog/core/local-store/identifiers";
import {
  decideTitleGeneration,
  formatPromptsForTitleInput,
  isAutoTitleLocked,
  selectPromptsForTitle,
} from "@posthog/core/sessions/chatTitle";
import { extractUserPromptsFromEvents } from "@posthog/core/sessions/sessionEvents";
import type { SessionService } from "@posthog/core/sessions/sessionService";
import { SESSION_SERVICE } from "@posthog/core/sessions/sessionService";
import { TITLE_GENERATOR_SERVICE } from "@posthog/core/sessions/titleGeneratorIdentifiers";
import type { TitleGeneratorService } from "@posthog/core/sessions/titleGeneratorService";
import {
  TASK_MUTATION_SERVICE,
  type TaskMutationService,
} from "@posthog/core/tasks/taskMutations";
import { TASKS_COLLECTION } from "@posthog/core/tasks/taskSync";
import { useService } from "@posthog/di/react";
import type { Task } from "@posthog/shared/domain-types";
import { useAuthStateValue } from "@posthog/ui/features/auth/store";
import {
  sessionStoreSetters,
  useSessionStore,
} from "@posthog/ui/features/sessions/sessionStore";
import { taskKeys } from "@posthog/ui/features/tasks/taskKeys";
import { logger } from "@posthog/ui/shell/logger";
import { titleAttachmentStoreApi } from "@posthog/ui/shell/titleAttachmentStore";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

const log = logger.scope("chat-title-generator");

function getPoolTask(
  registry: EntityRegistry,
  taskId: string,
): Task | undefined {
  try {
    return registry.getPool(TASKS_COLLECTION).get(taskId) as unknown as
      | Task
      | undefined;
  } catch {
    return undefined;
  }
}

export function useChatTitleGenerator(task: Task): void {
  const taskId = task.id;
  const sessionService = useService<SessionService>(SESSION_SERVICE);
  const registry = useService<EntityRegistry>(ENTITY_REGISTRY);
  const mutations = useService<TaskMutationService>(TASK_MUTATION_SERVICE);
  const titleGenerator = useService<TitleGeneratorService>(
    TITLE_GENERATOR_SERVICE,
  );
  const queryClient = useQueryClient();
  const lastGeneratedAtCount = useRef(0);
  const initialDescriptionHandled = useRef(false);
  const isGenerating = useRef(false);
  const isAuthenticated = useAuthStateValue(
    (state) => state.status === "authenticated" && !!state.cloudRegion,
  );

  const promptCount = useSessionStore((state) => {
    const taskRunId = state.taskIdIndex[taskId];
    if (!taskRunId) return 0;
    const session = state.sessions[taskRunId];
    if (!session?.events) return 0;
    return extractUserPromptsFromEvents(session.events).length;
  });

  useEffect(() => {
    if (!isAuthenticated) return;
    if (isGenerating.current) return;

    const { shouldGenerateFromPrompts, shouldGenerateFromTaskDescription } =
      decideTitleGeneration({
        promptCount,
        lastGeneratedAtCount: lastGeneratedAtCount.current,
        initialDescriptionHandled: initialDescriptionHandled.current,
        task,
      });

    if (!shouldGenerateFromPrompts && !shouldGenerateFromTaskDescription) {
      return;
    }

    isGenerating.current = true;

    const state = useSessionStore.getState();
    const taskRunId = state.taskIdIndex[taskId];
    const session = taskRunId ? state.sessions[taskRunId] : undefined;
    let rawContent = task.description;

    if (shouldGenerateFromPrompts) {
      if (!session?.events) {
        isGenerating.current = false;
        return;
      }

      const allPrompts = extractUserPromptsFromEvents(session.events);
      const promptsForTitle = selectPromptsForTitle(allPrompts, promptCount);

      rawContent = formatPromptsForTitleInput(promptsForTitle);
    }

    const run = async () => {
      try {
        const attachmentPaths = titleAttachmentStoreApi.get(taskId) ?? [];
        const content = await titleGenerator.enrichDescriptionWithFileContent(
          rawContent,
          attachmentPaths,
        );
        const result = await titleGenerator.generateTitleAndSummary(content);
        if (result) {
          // Drop the stash once a title has been successfully produced so the
          // map doesn't grow across a long-lived session. Keeping it on failure
          // lets the prompt-based regeneration at REGENERATE_INTERVAL pick it
          // up and try again with the file contents.
          titleAttachmentStoreApi.clear(taskId);
          const { title, summary } = result;
          const titleLocked = isAutoTitleLocked(
            getPoolTask(registry, taskId) ?? task,
          );

          if (title && titleLocked) {
            log.debug("Skipping auto-title, user renamed task", { taskId });
          } else if (title) {
            await mutations.updateTask(taskId, { title });
            queryClient.setQueryData<Task>(taskKeys.detail(taskId), (old) =>
              old ? { ...old, title } : old,
            );
            sessionService.updateSessionTaskTitle(taskId, title);
            log.debug("Updated task title from conversation", {
              taskId,
              promptCount,
            });
          }

          if (summary && taskRunId) {
            sessionStoreSetters.updateSession(taskRunId, {
              conversationSummary: result.summary,
            });

            log.debug("Updated task summary from conversation", {
              taskId,
              promptCount,
            });
          }
        }
      } catch (error) {
        log.error("Failed to update task title", { taskId, error });
      } finally {
        if (shouldGenerateFromPrompts) {
          lastGeneratedAtCount.current = promptCount;
        }
        if (shouldGenerateFromTaskDescription) {
          initialDescriptionHandled.current = true;
        }
        isGenerating.current = false;
      }
    };

    run();
  }, [
    isAuthenticated,
    promptCount,
    taskId,
    task,
    queryClient,
    sessionService,
    titleGenerator,
    mutations.updateTask,
    registry,
  ]);
}

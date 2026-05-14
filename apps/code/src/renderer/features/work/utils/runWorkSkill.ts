import { get } from "@renderer/di/container";
import { RENDERER_TOKENS } from "@renderer/di/tokens";
import type {
  CreateTaskResult,
  TaskCreationInput,
  TaskService,
} from "@renderer/features/task-detail/service/service";
import { trpcClient } from "@renderer/trpc/client";
import { toast } from "@renderer/utils/toast";
import { logger } from "@utils/logger";

const log = logger.scope("run-work-skill");

async function resolveRepoPath(folders: string[]): Promise<string> {
  if (folders.length > 0) return folders[0];
  return trpcClient.os.getHomeDir.query();
}

export interface RunWorkSkillOptions {
  /** Final prompt content to send to the agent. */
  prompt: string;
  /** Available folder paths — first one is used as the repo, else $HOME. */
  folders: string[];
  /** Called once the saga produces a taskId (before it fully completes). */
  onTaskCreated: (taskId: string) => void;
  /** Human-readable label used for the failure toast. */
  failureLabel?: string;
}

/**
 * Shared task-creation flow used by both the generator (Work → New skill) and
 * catalog Run-now (Work → Library → Run now).
 */
export async function runWorkSkill(
  options: RunWorkSkillOptions,
): Promise<CreateTaskResult> {
  const { prompt, folders, onTaskCreated, failureLabel } = options;

  try {
    const repoPath = await resolveRepoPath(folders);

    const input: TaskCreationInput = {
      content: prompt,
      repoPath,
      workspaceMode: "local",
    };

    const taskService = get<TaskService>(RENDERER_TOKENS.TaskService);
    const result = await taskService.createTask(input, (output) => {
      onTaskCreated(output.task.id);
    });

    if (!result.success) {
      toast.error(failureLabel ?? "Failed to start skill", {
        description: result.error,
      });
      log.error("Skill task creation failed", {
        failedStep: result.failedStep,
        error: result.error,
      });
    }
    return result;
  } catch (error) {
    const description =
      error instanceof Error ? error.message : "Unknown error";
    toast.error(failureLabel ?? "Failed to start skill", { description });
    log.error("Unexpected error during skill task creation", { error });
    return {
      success: false,
      error: description,
      failedStep: "unknown",
    };
  }
}

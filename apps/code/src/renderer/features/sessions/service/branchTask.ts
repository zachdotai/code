/**
 * Branches a task: creates a new task seeded with an LLM summary of the
 * source task's conversation.
 */
import { useBranchLineageStore } from "@features/sessions/stores/branchLineageStore";
import { sessionStoreSetters } from "@features/sessions/stores/sessionStore";
import { buildBranchTranscript } from "@features/sessions/utils/branchContext";
import type {
  TaskCreationInput,
  TaskService,
} from "@features/task-detail/service/service";
import type { Workspace } from "@main/services/workspace/schemas";
import { get } from "@renderer/di/container";
import { RENDERER_TOKENS } from "@renderer/di/tokens";
import type { BranchLineage, Task } from "@shared/types";
import { generateBranchSummary } from "@utils/generateBranchSummary";
import { logger } from "@utils/logger";

const log = logger.scope("branch-task");

export interface BranchTaskParams {
  task: Task;
  workspace: Workspace | null;
  /** Phase 1 only supports carrying summarised context. */
  mode: "context";
}

export interface BranchTaskResult {
  success: boolean;
  error?: string;
}

function buildBranchPrompt(task: Task, context: string): string {
  const ref = task.task_number ? `task #${task.task_number}` : "another task";
  return `This task was branched from ${ref} ("${task.title}"). The summary below captures everything decided and done so far — continue the work from this point.

<branch-context>
${context}
</branch-context>`;
}

/** `onTaskCreated` fires once the new task exists. */
export async function branchTask(
  params: BranchTaskParams,
  onTaskCreated: (task: Task) => void,
): Promise<BranchTaskResult> {
  const { task, workspace } = params;

  const isCloud = workspace?.mode === "cloud";
  if (!isCloud && !workspace?.folderPath) {
    return { success: false, error: "Source task has no local workspace" };
  }

  // Gather the conversation so far from the live session, if any.
  const events = sessionStoreSetters.getSessionByTaskId(task.id)?.events ?? [];
  const { transcript, turnCount } = buildBranchTranscript(events);

  const summary = await generateBranchSummary(
    transcript ||
      "(No conversation yet — only the task description is available.)",
    task.description,
  );

  // Fall back to the raw transcript if summarisation failed.
  const context = summary?.context ?? transcript;
  if (!context.trim()) {
    return { success: false, error: "Nothing to branch — no context found" };
  }
  const title = summary?.title ?? `Branch of ${task.title}`;

  const content = buildBranchPrompt(task, context);

  const input: TaskCreationInput = {
    content,
    taskDescription: context,
    taskTitle: title,
    workspaceMode: isCloud ? "cloud" : (workspace?.mode ?? "worktree"),
    repoPath: isCloud ? undefined : (workspace?.folderPath ?? undefined),
    repository: task.repository ?? undefined,
    githubIntegrationId: isCloud
      ? (task.github_integration ?? undefined)
      : undefined,
    githubUserIntegrationId: isCloud
      ? (task.github_user_integration ?? undefined)
      : undefined,
    // Keep the branch consistent with the source run's agent setup.
    adapter: task.latest_run?.runtime_adapter ?? undefined,
    model: task.latest_run?.model ?? undefined,
    reasoningLevel: task.latest_run?.reasoning_effort ?? undefined,
  };

  const lineage: BranchLineage = {
    parentTaskId: task.id,
    parentTaskNumber: task.task_number,
    parentTaskTitle: task.title,
    parentRunId: task.latest_run?.id ?? null,
    branchedAtTurn: turnCount,
    branchedAt: new Date().toISOString(),
    mode: "context",
  };

  try {
    const taskService = get<TaskService>(RENDERER_TOKENS.TaskService);
    const result = await taskService.createTask(input, (output) => {
      useBranchLineageStore.getState().setLineage(output.task.id, lineage);
      onTaskCreated(output.task);
    });

    if (!result.success) {
      log.error("Branch task creation failed", {
        failedStep: result.failedStep,
        error: result.error,
      });
      return { success: false, error: result.error };
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    log.error("Unexpected error while branching task", { error });
    return { success: false, error: message };
  }
}

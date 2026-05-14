import { inject, injectable } from "inversify";
import type { Task, TaskRun, TaskRunStatus } from "../../../shared/types";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import type { AuthService } from "../auth/service";

const log = logger.scope("hedgemony-cloud-task-client");

interface CreateTaskRunOptions {
  environment?: "local" | "cloud";
  mode?: "background" | "interactive";
  branch?: string | null;
  runtimeAdapter?: "claude" | "codex";
  model?: string;
}

interface StartTaskRunOptions {
  pendingUserMessage?: string;
}

interface UpdateTaskRunPatch {
  status?: TaskRunStatus;
  errorMessage?: string | null;
}

/**
 * Thin main-process client for the cloud task API. Mirrors the renderer-side
 * `PosthogAPIClient` task surface that the hedgehog tick service needs:
 * createTaskRun, startTaskRun, updateTaskRun, getTaskWithLatestRun. Uses
 * `AuthService.authenticatedFetch` and resolves `team_id` lazily (cached after
 * first call) — same pattern as `AffinityRouterService`.
 */
@injectable()
export class CloudTaskClient {
  private cachedTeamId: number | null = null;

  constructor(
    @inject(MAIN_TOKENS.AuthService)
    private readonly auth: AuthService,
  ) {}

  async getTaskWithLatestRun(
    taskId: string,
  ): Promise<{ task: Task; latestRun: TaskRun | null }> {
    const { apiHost, teamId } = await this.resolveContext();
    const response = await this.auth.authenticatedFetch(
      fetch,
      `${apiHost}/api/projects/${teamId}/tasks/${taskId}/`,
    );
    if (!response.ok) {
      throw new Error(
        `cloud_task_fetch_failed: HTTP ${response.status} for task ${taskId}`,
      );
    }
    const task = (await response.json()) as Task;
    return { task, latestRun: task.latest_run ?? null };
  }

  async createTaskRun(
    taskId: string,
    options: CreateTaskRunOptions = {},
  ): Promise<TaskRun> {
    const { apiHost, teamId } = await this.resolveContext();
    const body: Record<string, unknown> = {
      environment: options.environment ?? "cloud",
      mode: options.mode ?? "background",
    };
    if (options.branch !== undefined) body.branch = options.branch;
    if (options.runtimeAdapter !== undefined) {
      body.runtime_adapter = options.runtimeAdapter;
    }
    if (options.model !== undefined) body.model = options.model;

    const response = await this.auth.authenticatedFetch(
      fetch,
      `${apiHost}/api/projects/${teamId}/tasks/${taskId}/runs/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      log.error("createTaskRun failed", {
        taskId,
        status: response.status,
        errorText,
      });
      throw new Error(`create_task_run_failed: HTTP ${response.status}`);
    }
    return (await response.json()) as TaskRun;
  }

  async startTaskRun(
    taskId: string,
    runId: string,
    options: StartTaskRunOptions = {},
  ): Promise<Task> {
    const { apiHost, teamId } = await this.resolveContext();
    const body: Record<string, unknown> = {};
    if (options.pendingUserMessage !== undefined) {
      body.pending_user_message = options.pendingUserMessage;
    }
    const response = await this.auth.authenticatedFetch(
      fetch,
      `${apiHost}/api/projects/${teamId}/tasks/${taskId}/runs/${runId}/start/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      log.error("startTaskRun failed", {
        taskId,
        runId,
        status: response.status,
        errorText,
      });
      throw new Error(`start_task_run_failed: HTTP ${response.status}`);
    }
    return (await response.json()) as Task;
  }

  async updateTaskRun(
    taskId: string,
    runId: string,
    patch: UpdateTaskRunPatch,
  ): Promise<TaskRun> {
    const { apiHost, teamId } = await this.resolveContext();
    const body: Record<string, unknown> = {};
    if (patch.status !== undefined) body.status = patch.status;
    if (patch.errorMessage !== undefined)
      body.error_message = patch.errorMessage;

    const response = await this.auth.authenticatedFetch(
      fetch,
      `${apiHost}/api/projects/${teamId}/tasks/${taskId}/runs/${runId}/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      log.error("updateTaskRun failed", {
        taskId,
        runId,
        status: response.status,
        errorText,
      });
      throw new Error(`update_task_run_failed: HTTP ${response.status}`);
    }
    return (await response.json()) as TaskRun;
  }

  private async resolveContext(): Promise<{ apiHost: string; teamId: number }> {
    const { apiHost } = await this.auth.getValidAccessToken();
    const stateProjectId = this.auth.getState().projectId;
    if (typeof stateProjectId === "number") {
      return { apiHost, teamId: stateProjectId };
    }
    if (this.cachedTeamId !== null) {
      return { apiHost, teamId: this.cachedTeamId };
    }
    const response = await this.auth.authenticatedFetch(
      fetch,
      `${apiHost}/api/users/@me/`,
    );
    if (!response.ok) {
      throw new Error("cloud_task_team_unresolved");
    }
    const data = (await response.json().catch(() => ({}))) as {
      team?: { id?: unknown } | null;
    };
    const id = data.team?.id;
    if (typeof id !== "number") {
      throw new Error("cloud_task_team_unresolved");
    }
    this.cachedTeamId = id;
    return { apiHost, teamId: id };
  }
}

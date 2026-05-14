import { inject, injectable } from "inversify";
import type {
  ExecutionMode,
  Task,
  TaskRun,
  TaskRunStatus,
} from "../../../shared/types";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import type { AuthService } from "../auth/service";
import type { HedgemonyReasoningEffort } from "./schemas";

const log = logger.scope("hedgemony-cloud-task-client");

const REPO_INTEGRATION_CACHE_TTL_MS = 5 * 60 * 1000;

interface CreateTaskRunOptions {
  environment?: "local" | "cloud";
  mode?: "background" | "interactive";
  branch?: string | null;
  runtimeAdapter?: "claude" | "codex";
  model?: string;
  reasoningEffort?: HedgemonyReasoningEffort;
  initialPermissionMode?: ExecutionMode;
  prAuthorshipMode?: "user" | "bot";
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
 * `AuthService.authenticatedFetch` and resolves `team_id` lazily from auth
 * state or the current user endpoint.
 */
@injectable()
export class CloudTaskClient {
  private cachedFallbackContext: { apiHost: string; teamId: number } | null =
    null;
  private repoIntegrationCache: {
    map: Map<string, string>;
    fetchedAt: number;
  } | null = null;

  constructor(
    @inject(MAIN_TOKENS.AuthService)
    private readonly auth: AuthService,
  ) {}

  async createTask(input: {
    title: string;
    description: string;
    repository?: string | null;
    originProduct?: string;
    githubIntegration?: number | null;
    githubUserIntegration?: string | null;
  }): Promise<Task> {
    const { apiHost, teamId } = await this.resolveContext();
    const body: Record<string, unknown> = {
      title: input.title,
      description: input.description,
      origin_product: input.originProduct ?? "user_created",
    };
    if (input.repository !== undefined) body.repository = input.repository;
    if (input.githubIntegration !== undefined) {
      body.github_integration = input.githubIntegration;
    }
    if (input.githubUserIntegration !== undefined) {
      body.github_user_integration = input.githubUserIntegration;
    }
    const response = await this.auth.authenticatedFetch(
      fetch,
      `${apiHost}/api/projects/${teamId}/tasks/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      log.error("createTask failed", {
        status: response.status,
        errorText,
      });
      throw new Error(`create_task_failed: HTTP ${response.status}`);
    }
    return (await response.json()) as Task;
  }

  async deleteTask(taskId: string): Promise<void> {
    const { apiHost, teamId } = await this.resolveContext();
    const response = await this.auth.authenticatedFetch(
      fetch,
      `${apiHost}/api/projects/${teamId}/tasks/${taskId}/`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      log.error("deleteTask failed", {
        taskId,
        status: response.status,
        errorText,
      });
      throw new Error(`delete_task_failed: HTTP ${response.status}`);
    }
  }

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
    if (options.reasoningEffort !== undefined) {
      body.reasoning_effort = options.reasoningEffort;
    }
    if (options.initialPermissionMode !== undefined) {
      body.initial_permission_mode = options.initialPermissionMode;
    }
    if (options.prAuthorshipMode !== undefined) {
      body.pr_authorship_mode = options.prAuthorshipMode;
    }

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

  /**
   * Resolves the GitHub user integration ID that covers `repository` (e.g.
   * "org/repo"). Fetches the user's GitHub installations and their repo
   * lists, caches the mapping for 5 minutes to avoid redundant calls across
   * rapid hoglet spawns.
   */
  async resolveGithubUserIntegration(
    repository: string,
  ): Promise<string | null> {
    const now = Date.now();
    if (
      this.repoIntegrationCache &&
      now - this.repoIntegrationCache.fetchedAt < REPO_INTEGRATION_CACHE_TTL_MS
    ) {
      return (
        this.repoIntegrationCache.map.get(repository.toLowerCase()) ?? null
      );
    }

    try {
      const { apiHost } = await this.resolveContext();
      const integrationsRes = await this.auth.authenticatedFetch(
        fetch,
        `${apiHost}/api/users/@me/integrations/`,
      );
      if (!integrationsRes.ok) {
        log.warn("resolveGithubUserIntegration: failed to fetch integrations", {
          status: integrationsRes.status,
        });
        return null;
      }
      const integrationsData = (await integrationsRes.json()) as {
        results?: Array<{ id: string; installation_id: string }>;
      };
      const integrations = integrationsData.results ?? [];

      const map = new Map<string, string>();
      await Promise.all(
        integrations.map(async (integration) => {
          const reposRes = await this.auth.authenticatedFetch(
            fetch,
            `${apiHost}/api/users/@me/integrations/github/${integration.installation_id}/repos/?limit=500`,
          );
          if (!reposRes.ok) return;
          const reposData = (await reposRes.json()) as {
            results?: string[];
          };
          for (const repo of reposData.results ?? []) {
            if (!map.has(repo.toLowerCase())) {
              map.set(repo.toLowerCase(), integration.id);
            }
          }
        }),
      );

      this.repoIntegrationCache = { map, fetchedAt: now };
      return map.get(repository.toLowerCase()) ?? null;
    } catch (error) {
      log.warn("resolveGithubUserIntegration failed", {
        repository,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async resolveContext(): Promise<{ apiHost: string; teamId: number }> {
    const { apiHost } = await this.auth.getValidAccessToken();
    const stateProjectId = this.auth.getState().projectId;
    if (typeof stateProjectId === "number") {
      this.cachedFallbackContext = { apiHost, teamId: stateProjectId };
      return { apiHost, teamId: stateProjectId };
    }
    if (this.cachedFallbackContext?.apiHost === apiHost) {
      return { apiHost, teamId: this.cachedFallbackContext.teamId };
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
    this.cachedFallbackContext = { apiHost, teamId: id };
    return { apiHost, teamId: id };
  }
}

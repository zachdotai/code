import crypto from "node:crypto";
import { inject, injectable } from "inversify";
import { z } from "zod";
import type {
  ExecutionMode,
  SignalReport,
  SignalReportArtefactsResponse,
  SignalReportsQueryParams,
  SignalReportsResponse,
  Task,
  TaskRun,
  TaskRunStatus,
} from "../../../shared/types";
import type { StoredLogEntry } from "../../../shared/types/session-events";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import type { AuthService } from "../auth/service";
import {
  type FeedbackProcessingState,
  feedbackProcessingState,
  type HedgemonyReasoningEffort,
  repoSlugSchema,
} from "./schemas";

const log = logger.scope("hedgemony-cloud-task-client");

const REPO_INTEGRATION_CACHE_TTL_MS = 5 * 60 * 1000;

export class CloudApiResponseError extends Error {
  constructor(
    readonly endpoint: string,
    readonly issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
  ) {
    super(`cloud_api_response_invalid: ${endpoint}`);
    this.name = "CloudApiResponseError";
  }
}

/**
 * Run a Zod schema over a `Response` JSON body. Throws `CloudApiResponseError`
 * on shape mismatch so callers get a typed signal that the cloud returned
 * something unsafe to consume. We never trust the response to be well-formed.
 */
async function parseJsonResponse<TSchema extends z.ZodTypeAny>(
  endpoint: string,
  response: Response,
  schema: TSchema,
): Promise<z.infer<TSchema>> {
  const raw = await response.json();
  const result = schema.safeParse(raw);
  if (!result.success) {
    log.warn("cloud API response rejected by schema", {
      endpoint,
      issues: result.error.issues.slice(0, 8).map((issue) => ({
        path: issue.path,
        code: issue.code,
        message: issue.message,
      })),
    });
    throw new CloudApiResponseError(
      endpoint,
      result.error.issues.map((issue) => ({
        path: issue.path,
        message: issue.message,
      })),
    );
  }
  return result.data;
}

const githubPrUrlSchema = z
  .string()
  .max(512)
  .refine((value) => {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:") return false;
      return url.host === "github.com" || url.host.endsWith(".github.com");
    } catch {
      return false;
    }
  }, "pr_url must be an https URL on github.com");

const branchSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._\-/]+$/);

const taskRunOutputSchema = z
  .object({
    pr_url: githubPrUrlSchema.optional().nullable(),
  })
  .passthrough()
  .nullable();

const taskRunSchema = z
  .object({
    id: z.string().min(1).max(64),
    task: z.string().min(1).max(64).optional(),
    branch: branchSchema.nullable().optional(),
    status: z.string().min(1).max(64).optional(),
    output: taskRunOutputSchema.optional(),
  })
  .passthrough();

const taskSchema = z
  .object({
    id: z.string().min(1).max(64),
    repository: repoSlugSchema.nullable().optional(),
    latest_run: taskRunSchema.nullable().optional(),
  })
  .passthrough();

const integrationsResponseSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            installation_id: z.string().min(1).max(64),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const repoEntrySchema = z.union([
  z.string().min(1).max(140),
  z
    .object({
      full_name: z.string().min(1).max(140).optional(),
      name: z.string().min(1).max(140).optional(),
    })
    .passthrough(),
]);

/**
 * The repos endpoint returns one of several shapes depending on installation
 * state and pagination wrapper. The renderer's `normalizeGithubRepositories`
 * already handles the same set; mirror its tolerance here so a wrapper change
 * doesn't silently empty the integration cache and lock the hedgehog out of
 * every repo for 5 minutes.
 */
const integrationReposResponseSchema = z
  .object({
    repositories: z.array(repoEntrySchema).optional(),
    results: z.array(repoEntrySchema).optional(),
  })
  .passthrough();

function extractRepoSlugs(
  data: z.infer<typeof integrationReposResponseSchema>,
): string[] {
  const entries = data.repositories ?? data.results ?? [];
  const slugs: string[] = [];
  for (const entry of entries) {
    if (typeof entry === "string") {
      slugs.push(entry);
      continue;
    }
    const slug = entry.full_name ?? entry.name;
    if (slug && slug.length > 0) slugs.push(slug);
  }
  return slugs;
}

const signalReportSchema = z
  .object({
    id: z.string().min(1).max(128),
  })
  .passthrough();

const signalReportsResponseSchema = z
  .object({
    results: z.array(signalReportSchema).optional(),
    count: z.number().optional(),
  })
  .passthrough();

const signalReportArtefactSchema = z
  .object({
    id: z.string().min(1).max(128),
    type: z.string().min(1).max(64),
  })
  .passthrough();

const signalReportArtefactsResponseSchema = z
  .object({
    results: z.array(signalReportArtefactSchema).optional(),
    count: z.number().optional(),
    unavailableReason: z.string().optional(),
  })
  .passthrough();

const taskRunCommandResponseSchema = z
  .object({
    jsonrpc: z.string().optional(),
    id: z.unknown().optional(),
    processed: z.unknown().optional(),
    result: z.unknown().optional(),
    error: z.unknown().optional(),
  })
  .passthrough();

const storedLogEntrySchema = z
  .object({
    type: z.string().min(1).max(128),
    timestamp: z.string().optional(),
    notification: z.unknown().optional(),
  })
  .passthrough();

const sessionLogsResponseSchema = z.array(storedLogEntrySchema);

/**
 * Reject `apiHost` values that would let the cloud API base URL escape into a
 * path component or non-HTTPS scheme. Auth state is the source of truth for
 * `apiHost`, but we never want to construct request URLs from a value that
 * could be coerced into reaching a different origin.
 */
function assertValidApiHost(apiHost: string): void {
  let parsed: URL;
  try {
    parsed = new URL(apiHost);
  } catch {
    throw new Error("cloud_api_host_invalid: not a URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("cloud_api_host_invalid: must be https");
  }
  if (parsed.pathname !== "" && parsed.pathname !== "/") {
    throw new Error("cloud_api_host_invalid: must not contain a path");
  }
  if (parsed.search !== "" || parsed.hash !== "") {
    throw new Error("cloud_api_host_invalid: must not contain query or hash");
  }
}

interface CreateTaskRunOptions {
  environment?: "local" | "cloud";
  mode?: "background" | "interactive";
  branch?: string | null;
  runtimeAdapter?: "claude" | "codex";
  model?: string;
  reasoningEffort?: HedgemonyReasoningEffort;
  initialPermissionMode?: ExecutionMode;
  prAuthorshipMode?: "user" | "bot";
  runSource?: string;
  signalReportId?: string | null;
}

interface StartTaskRunOptions {
  pendingUserMessage?: string;
}

interface UpdateTaskRunPatch {
  status?: TaskRunStatus;
  errorMessage?: string | null;
}

export type CloudTaskPromptInjectionResult =
  | { accepted: true; processed: FeedbackProcessingState }
  | {
      accepted: false;
      reason: "run_unavailable" | "rejected";
      message?: string;
    };

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
    slugs: string[];
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
    signalReport?: string | null;
    signalReportTaskRelationship?: string | null;
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
    if (input.signalReport !== undefined && input.signalReport !== null) {
      body.signal_report = input.signalReport;
    }
    if (
      input.signalReportTaskRelationship !== undefined &&
      input.signalReportTaskRelationship !== null
    ) {
      body.signal_report_task_relationship = input.signalReportTaskRelationship;
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
    return (await parseJsonResponse(
      "POST /tasks/",
      response,
      taskSchema,
    )) as unknown as Task;
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
    const task = (await parseJsonResponse(
      "GET /tasks/{id}/",
      response,
      taskSchema,
    )) as unknown as Task;
    return { task, latestRun: task.latest_run ?? null };
  }

  async getTaskRunSessionLogs(input: {
    taskId: string;
    runId: string;
    offset?: number;
    limit?: number;
  }): Promise<{ entries: StoredLogEntry[]; hasMore: boolean }> {
    const { apiHost, teamId } = await this.resolveContext();
    const url = new URL(
      `${apiHost}/api/projects/${teamId}/tasks/${input.taskId}/runs/${input.runId}/session_logs/`,
    );
    url.searchParams.set("limit", String(input.limit ?? 200));
    url.searchParams.set("offset", String(input.offset ?? 0));

    const response = await this.auth.authenticatedFetch(fetch, url.toString());
    if (!response.ok) {
      throw new Error(
        `cloud_task_session_logs_fetch_failed: HTTP ${response.status} for task ${input.taskId} run ${input.runId}`,
      );
    }

    const raw = await response.json();
    const parsed = sessionLogsResponseSchema.safeParse(raw);
    if (!parsed.success) {
      log.warn("cloud API response rejected by schema", {
        endpoint: "GET /tasks/{id}/runs/{runId}/session_logs/",
        issues: parsed.error.issues.slice(0, 8).map((issue) => ({
          path: issue.path,
          code: issue.code,
          message: issue.message,
        })),
      });
      throw new CloudApiResponseError(
        "GET /tasks/{id}/runs/{runId}/session_logs/",
        parsed.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      );
    }

    return {
      entries: parsed.data as StoredLogEntry[],
      hasMore: response.headers.get("X-Has-More") === "true",
    };
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
    if (options.runSource !== undefined) {
      body.run_source = options.runSource;
    }
    if (
      options.signalReportId !== undefined &&
      options.signalReportId !== null
    ) {
      body.signal_report_id = options.signalReportId;
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
    return (await parseJsonResponse(
      "POST /tasks/{id}/runs/",
      response,
      taskRunSchema,
    )) as unknown as TaskRun;
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
    return (await parseJsonResponse(
      "POST /tasks/{id}/runs/{runId}/start/",
      response,
      taskSchema,
    )) as unknown as Task;
  }

  async injectPrompt(input: {
    taskId: string;
    taskRunId: string;
    prompt: string;
    authoredBy: "hedgehog";
  }): Promise<CloudTaskPromptInjectionResult> {
    const { apiHost, teamId } = await this.resolveContext();
    const url = `${apiHost}/api/projects/${teamId}/tasks/${input.taskId}/runs/${input.taskRunId}/command/`;
    const response = await this.auth.authenticatedFetch(fetch, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "user_message",
        params: {
          content: formatInjectedPrompt(input),
        },
        id: `hedgemony-${input.authoredBy}-${crypto.randomUUID()}`,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      const reason =
        response.status === 400 || response.status === 404
          ? "run_unavailable"
          : "rejected";
      log.warn("injectPrompt failed", {
        taskId: input.taskId,
        taskRunId: input.taskRunId,
        status: response.status,
        reason,
        errorText,
      });
      return { accepted: false, reason, message: errorText || undefined };
    }

    const data = await parseJsonResponse(
      "POST /tasks/{id}/runs/{runId}/command/",
      response,
      taskRunCommandResponseSchema,
    );
    if (data.error != null) {
      const message = commandErrorMessage(data.error);
      log.warn("injectPrompt command rejected", {
        taskId: input.taskId,
        taskRunId: input.taskRunId,
        error: message,
      });
      return { accepted: false, reason: "rejected", message };
    }

    return { accepted: true, processed: extractProcessedState(data) };
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
    return (await parseJsonResponse(
      "PATCH /tasks/{id}/runs/{runId}/",
      response,
      taskRunSchema,
    )) as unknown as TaskRun;
  }

  async listSignalReports(
    params: SignalReportsQueryParams = {},
  ): Promise<SignalReportsResponse> {
    const { apiHost, teamId } = await this.resolveContext();
    const url = new URL(`${apiHost}/api/projects/${teamId}/signals/reports/`);
    if (params.limit != null)
      url.searchParams.set("limit", String(params.limit));
    if (params.offset != null) {
      url.searchParams.set("offset", String(params.offset));
    }
    if (params.status) url.searchParams.set("status", params.status);
    if (params.ordering) url.searchParams.set("ordering", params.ordering);
    if (params.source_product) {
      url.searchParams.set("source_product", params.source_product);
    }
    if (params.suggested_reviewers) {
      url.searchParams.set("suggested_reviewers", params.suggested_reviewers);
    }

    const response = await this.auth.authenticatedFetch(fetch, url.toString());
    if (!response.ok) {
      throw new Error(`list_signal_reports_failed: HTTP ${response.status}`);
    }
    const data = await parseJsonResponse(
      "GET /signals/reports/",
      response,
      signalReportsResponseSchema,
    );
    return {
      results: (data.results ?? []) as unknown as SignalReport[],
      count: data.count ?? data.results?.length ?? 0,
    };
  }

  async getSignalReportArtefacts(
    reportId: string,
  ): Promise<SignalReportArtefactsResponse> {
    const { apiHost, teamId } = await this.resolveContext();
    const url = `${apiHost}/api/projects/${teamId}/signals/reports/${encodeURIComponent(reportId)}/artefacts/`;
    const response = await this.auth.authenticatedFetch(fetch, url);
    if (!response.ok) {
      const unavailableReason =
        response.status === 403
          ? "forbidden"
          : response.status === 404
            ? "not_found"
            : "request_failed";
      log.warn("Signal report artefacts unavailable", {
        reportId,
        status: response.status,
      });
      return { results: [], count: 0, unavailableReason };
    }
    const data = await parseJsonResponse(
      "GET /signals/reports/{id}/artefacts/",
      response,
      signalReportArtefactsResponseSchema,
    );
    return {
      results: (data.results ??
        []) as unknown as SignalReportArtefactsResponse["results"],
      count: data.count ?? data.results?.length ?? 0,
    };
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
      const integrationsData = await parseJsonResponse(
        "GET /users/@me/integrations/",
        integrationsRes,
        integrationsResponseSchema,
      );
      const integrations = integrationsData.results ?? [];

      const map = new Map<string, string>();
      const slugs: string[] = [];
      let anyInstallationFailed = false;
      await Promise.all(
        integrations.map(async (integration) => {
          const reposRes = await this.auth.authenticatedFetch(
            fetch,
            `${apiHost}/api/users/@me/integrations/github/${integration.installation_id}/repos/?limit=500`,
          );
          if (!reposRes.ok) {
            anyInstallationFailed = true;
            log.warn("integration repos fetch failed", {
              installationId: integration.installation_id,
              status: reposRes.status,
            });
            return;
          }
          let reposData: z.infer<typeof integrationReposResponseSchema>;
          try {
            reposData = await parseJsonResponse(
              "GET /users/@me/integrations/github/{installationId}/repos/",
              reposRes,
              integrationReposResponseSchema,
            );
          } catch (error) {
            anyInstallationFailed = true;
            log.warn("integration repos response rejected by schema", {
              installationId: integration.installation_id,
              error: error instanceof Error ? error.message : String(error),
            });
            return;
          }
          for (const repo of extractRepoSlugs(reposData)) {
            const key = repo.toLowerCase();
            if (!map.has(key)) {
              map.set(key, integration.id);
              slugs.push(repo);
            }
          }
        }),
      );

      // If every installation's repo list failed, don't cache — otherwise the
      // hedgehog gets locked out for 5 minutes on transient network blips.
      if (anyInstallationFailed && map.size === 0) {
        log.warn(
          "resolveGithubUserIntegration: all installation repo fetches failed, skipping cache write",
          { repository, integrationCount: integrations.length },
        );
        return null;
      }

      this.repoIntegrationCache = { map, slugs, fetchedAt: now };
      const matched = map.get(repository.toLowerCase()) ?? null;
      log.info("resolveGithubUserIntegration result", {
        repository,
        lookupKey: repository.toLowerCase(),
        matchedIntegrationId: matched,
        mapSize: map.size,
        sampleSlugs: slugs.slice(0, 10),
        anyInstallationFailed,
      });
      return matched;
    } catch (error) {
      log.warn("resolveGithubUserIntegration failed", {
        repository,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async listAccessibleRepositorySlugs(): Promise<string[]> {
    try {
      await this.resolveGithubUserIntegration("__cache_warmup__");
      return [...(this.repoIntegrationCache?.slugs ?? [])];
    } catch (error) {
      log.warn("listAccessibleRepositorySlugs failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private async resolveContext(): Promise<{ apiHost: string; teamId: number }> {
    const { apiHost } = await this.auth.getValidAccessToken();
    assertValidApiHost(apiHost);
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

function formatInjectedPrompt(input: {
  prompt: string;
  authoredBy: "hedgehog";
}): string {
  return `Message from the Hedgemony hedgehog orchestrating this nest:\n\n${input.prompt}`;
}

function extractProcessedState(
  data: z.infer<typeof taskRunCommandResponseSchema>,
): FeedbackProcessingState {
  const topLevel = feedbackProcessingState.safeParse(data.processed);
  if (topLevel.success) return topLevel.data;
  if (data.result && typeof data.result === "object") {
    const nested = (data.result as { processed?: unknown }).processed;
    const parsed = feedbackProcessingState.safeParse(nested);
    if (parsed.success) return parsed.data;
  }
  return "unknown";
}

function commandErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
    try {
      return JSON.stringify(error);
    } catch {
      return "Command rejected";
    }
  }
  return "Command rejected";
}

import {
  PostHogAPIClient,
  type ScoutConfig,
  type ScoutEmission,
  type ScoutMetadata,
  type ScoutRun,
  type ScoutRunsQueryParams,
  type SignalSourceConfig,
  setPosthogApiClientAppVersion,
} from "@posthog/api-client/posthog-client";
import type {
  DismissalReasonOptionValue,
  StoredLogEntry,
} from "@posthog/shared";
import type {
  Signal,
  SignalReport,
  SignalReportArtefactsResponse,
  SignalReportSignalsResponse,
  SignalReportsQueryParams,
  SignalReportsResponse,
  Task,
  TaskRun,
} from "@posthog/shared/domain-types";

// Re-export the domain shapes so consumers (the pi extension, a future
// standalone TUI) depend on this one facade rather than reaching into
// @posthog/api-client and @posthog/shared directly.
export type {
  DismissalReasonOptionValue,
  ScoutConfig,
  ScoutEmission,
  ScoutMetadata,
  ScoutRun,
  ScoutRunsQueryParams,
  Signal,
  SignalReport,
  SignalReportsQueryParams,
  SignalSourceConfig,
  StoredLogEntry,
  Task,
  TaskRun,
};

export interface SignalsClientConfig {
  /** Region base URL, e.g. https://us.posthog.com or https://eu.posthog.com. */
  apiHost: string;
  /** Personal API key (phx_…). Sent as a Bearer token. */
  personalApiKey: string;
  /**
   * Numeric project (team) id. Optional — when omitted it is resolved once via
   * /api/users/@me/ and cached. Scout and responder endpoints take the id
   * explicitly, so we always need a concrete number for those calls.
   */
  projectId?: number;
  /** User-Agent suffix. Defaults to "pi-ext". */
  appVersion?: string;
}

/** Inbox state mutations, mirroring the report `state/` endpoint's accepted shapes. */
export type ReportStateInput =
  | { state: "potential"; snoozeForSeconds?: number; resetWeight?: boolean }
  | {
      state: "suppressed";
      dismissalReason?: DismissalReasonOptionValue;
      dismissalNote?: string;
      resetWeight?: boolean;
    };

export interface CreateTaskInput {
  description: string;
  title?: string;
  repository?: string;
  /** Defaults to "pi" so work originated here is attributable in the inbox. */
  originProduct?: string;
  /** Report id to link this task back to (sets the report → task relationship). */
  signalReport?: string;
}

export interface SignalsClient {
  /** Resolve and cache the numeric project id (from config or /api/users/@me/). */
  getProjectId(): Promise<number>;
  inbox: {
    list(params?: SignalReportsQueryParams): Promise<SignalReportsResponse>;
    get(reportId: string): Promise<SignalReport | null>;
    signals(reportId: string): Promise<SignalReportSignalsResponse>;
    artefacts(reportId: string): Promise<SignalReportArtefactsResponse>;
    setState(reportId: string, input: ReportStateInput): Promise<SignalReport>;
    snooze(reportId: string, seconds: number): Promise<SignalReport>;
    suppress(
      reportId: string,
      opts?: { reason?: DismissalReasonOptionValue; note?: string },
    ): Promise<SignalReport>;
    reingest(reportId: string): Promise<{ status: string; report_id: string }>;
    delete(reportId: string): Promise<{ status: string; report_id: string }>;
  };
  scouts: {
    listConfigs(): Promise<ScoutConfig[]>;
    metadata(): Promise<ScoutMetadata>;
    runs(params?: ScoutRunsQueryParams): Promise<ScoutRun[]>;
    run(runId: string): Promise<ScoutRun>;
    emissions(runId: string): Promise<ScoutEmission[]>;
    toggle(
      configId: string,
      updates: {
        enabled?: boolean;
        emit?: boolean;
        runIntervalMinutes?: number;
      },
    ): Promise<ScoutConfig>;
  };
  responders: {
    list(): Promise<SignalSourceConfig[]>;
    toggle(configId: string, enabled: boolean): Promise<SignalSourceConfig>;
  };
  tasks: {
    list(originProduct?: string): Promise<Task[]>;
    create(input: CreateTaskInput): Promise<Task>;
    createRun(
      taskId: string,
      options?: {
        environment?: "local" | "cloud";
        mode?: "background" | "interactive";
      },
    ): Promise<TaskRun>;
    startRun(
      taskId: string,
      runId: string,
      options?: { pendingUserMessage?: string },
    ): Promise<Task>;
    status(taskId: string, runId: string): Promise<TaskRun>;
    logs(
      taskId: string,
      runId: string,
      options?: { limit?: number; after?: string },
    ): Promise<StoredLogEntry[]>;
  };
}

/**
 * Build a portable signals client backed by the PostHog Cloud REST API. The only
 * auth needed is a Personal API key; both token callbacks return it and the
 * fetcher attaches it as a Bearer header.
 */
export function createSignalsClient(
  config: SignalsClientConfig,
): SignalsClient {
  setPosthogApiClientAppVersion(config.appVersion ?? "pi-ext");

  const baseHost = config.apiHost.endsWith("/")
    ? config.apiHost.slice(0, -1)
    : config.apiHost;
  const token = async () => config.personalApiKey;

  const api = new PostHogAPIClient(baseHost, token, token, config.projectId);

  let cachedProjectId: number | null = config.projectId ?? null;
  const getProjectId = async (): Promise<number> => {
    if (cachedProjectId != null) return cachedProjectId;
    const response = await fetch(`${baseHost}/api/users/@me/`, {
      headers: { Authorization: `Bearer ${config.personalApiKey}` },
    });
    if (!response.ok) {
      throw new Error(
        `Could not resolve project id (/api/users/@me/ returned ${response.status}). ` +
          "Set projectId / POSTHOG_PROJECT_ID explicitly.",
      );
    }
    const user = (await response.json()) as { team?: { id?: number } };
    const id = user?.team?.id;
    if (typeof id !== "number") {
      throw new Error("Could not resolve project id from /api/users/@me/.");
    }
    cachedProjectId = id;
    api.setTeamId(id);
    return id;
  };

  return {
    getProjectId,
    inbox: {
      list: (params) => api.getSignalReports(params),
      get: (reportId) => api.getSignalReport(reportId),
      signals: (reportId) => api.getSignalReportSignals(reportId),
      artefacts: (reportId) => api.getSignalReportArtefacts(reportId),
      setState: (reportId, input) =>
        api.updateSignalReportState(
          reportId,
          input.state === "potential"
            ? {
                state: "potential",
                snooze_for: input.snoozeForSeconds,
                reset_weight: input.resetWeight,
              }
            : {
                state: "suppressed",
                dismissal_reason: input.dismissalReason,
                dismissal_note: input.dismissalNote,
                reset_weight: input.resetWeight,
              },
        ),
      snooze: (reportId, seconds) =>
        api.updateSignalReportState(reportId, {
          state: "potential",
          snooze_for: seconds,
        }),
      suppress: (reportId, opts) =>
        api.updateSignalReportState(reportId, {
          state: "suppressed",
          dismissal_reason: opts?.reason,
          dismissal_note: opts?.note,
        }),
      reingest: (reportId) => api.reingestSignalReport(reportId),
      delete: (reportId) => api.deleteSignalReport(reportId),
    },
    scouts: {
      listConfigs: async () => api.listScoutConfigs(await getProjectId()),
      metadata: async () => api.getScoutMetadata(await getProjectId()),
      runs: async (params) => api.listScoutRuns(await getProjectId(), params),
      run: async (runId) => api.getScoutRun(await getProjectId(), runId),
      emissions: async (runId) =>
        api.batchScoutRunEmissions(await getProjectId(), [runId]),
      toggle: async (configId, updates) =>
        api.updateScoutConfig(await getProjectId(), configId, {
          enabled: updates.enabled,
          emit: updates.emit,
          run_interval_minutes: updates.runIntervalMinutes,
        }),
    },
    responders: {
      list: async () => api.listSignalSourceConfigs(await getProjectId()),
      toggle: async (configId, enabled) =>
        api.updateSignalSourceConfig(await getProjectId(), configId, {
          enabled,
        }),
    },
    tasks: {
      // getTasks/createTask return the OpenAPI-generated Task shape; normalise to
      // the shared domain Task (structurally compatible, looser optionals).
      list: async (originProduct) =>
        (await api.getTasks({ originProduct })) as unknown as Task[],
      create: async (input) =>
        (await api.createTask({
          description: input.description,
          title: input.title,
          repository: input.repository,
          origin_product: input.originProduct ?? "pi",
          signal_report: input.signalReport,
        })) as unknown as Task,
      createRun: (taskId, options) => api.createTaskRun(taskId, options),
      startRun: (taskId, runId, options) =>
        api.startTaskRun(taskId, runId, {
          pendingUserMessage: options?.pendingUserMessage,
        }),
      status: (taskId, runId) => api.getTaskRun(taskId, runId),
      logs: (taskId, runId, options) =>
        api.getTaskRunSessionLogs(taskId, runId, options),
    },
  };
}

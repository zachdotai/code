export type TaskRunStatus =
  | "not_started"
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";

export const TERMINAL_STATUSES = new Set<TaskRunStatus>([
  "completed",
  "failed",
  "cancelled",
]);

export function isTerminalStatus(
  status: TaskRunStatus | null | undefined,
): boolean {
  return status != null && TERMINAL_STATUSES.has(status);
}

export interface Task {
  id: string;
  task_number?: number;
  slug?: string;
  title: string;
  description: string;
  origin_product: string;
  repository: string;
  json_schema?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  latest_run?: TaskRun;
}

export interface TaskRun {
  id: string;
  task: string;
  team: number;
  branch: string | null;
  stage: string | null;
  environment: "local" | "cloud";
  status: TaskRunStatus;
  log_url: string;
  error_message: string | null;
  output: Record<string, unknown> | null;
  state: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface PermissionOption {
  optionId: string;
  label: string;
  kind: "allow_once" | "allow_always" | "reject";
  description?: string;
}

export interface PermissionRequestEvent {
  type: "permission_request";
  requestId: string;
  toolCall: {
    toolCallId: string;
    title: string;
    kind: string;
    content?: unknown[];
    rawInput?: Record<string, unknown>;
    _meta?: Record<string, unknown>;
  };
  options: PermissionOption[];
}

export interface TaskRunStateEvent {
  type: "task_run_state";
  status?: TaskRunStatus;
  stage?: string | null;
  output?: Record<string, unknown> | null;
  error_message?: string | null;
  branch?: string | null;
}

/** Stored log entry (NDJSON line from the logs endpoint or SSE stream). */
export interface LogEntry {
  type: string;
  timestamp?: string;
  notification?: {
    method?: string;
    params?: unknown;
  };
}

export interface ClientConfig {
  apiUrl: string;
  apiKey: string;
  projectId: number;
}

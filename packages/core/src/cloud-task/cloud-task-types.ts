import type { StoredLogEntry, TaskRunStatus } from "@posthog/shared";

interface CloudTaskUpdateBase {
  taskId: string;
  runId: string;
}

export interface CloudTaskLogsUpdate extends CloudTaskUpdateBase {
  kind: "logs";
  newEntries: StoredLogEntry[];
  totalEntryCount: number;
}

export interface CloudTaskStatusUpdate extends CloudTaskUpdateBase {
  kind: "status";
  status?: TaskRunStatus;
  stage?: string | null;
  output?: Record<string, unknown> | null;
  errorMessage?: string | null;
  branch?: string | null;
  sandboxAlive?: boolean | null;
}

export interface CloudTaskSnapshotUpdate extends CloudTaskUpdateBase {
  kind: "snapshot";
  newEntries: StoredLogEntry[];
  totalEntryCount: number;
  status?: TaskRunStatus;
  stage?: string | null;
  output?: Record<string, unknown> | null;
  errorMessage?: string | null;
  branch?: string | null;
  sandboxAlive?: boolean | null;
}

export interface CloudTaskErrorUpdate extends CloudTaskUpdateBase {
  kind: "error";
  errorTitle: string;
  errorMessage: string;
  retryable: boolean;
}

/**
 * Transient posture: the client lost its stream connection but the run is still
 * executing server-side (typically a local network drop). Distinct from
 * `error`, which is a genuine terminal failure with a Retry affordance. The
 * watcher resumes on its own when the network returns.
 */
export interface CloudTaskReconnectingUpdate extends CloudTaskUpdateBase {
  kind: "reconnecting";
}

export interface CloudPermissionOption {
  kind: string;
  optionId: string;
  name: string;
  _meta?: Record<string, unknown>;
}

export interface CloudTaskPermissionRequestUpdate extends CloudTaskUpdateBase {
  kind: "permission_request";
  requestId: string;
  toolCall: {
    toolCallId: string;
    title: string;
    kind: string;
    content?: unknown[];
    rawInput?: Record<string, unknown>;
    _meta?: Record<string, unknown>;
  };
  options: CloudPermissionOption[];
}

export type CloudTaskUpdatePayload =
  | CloudTaskLogsUpdate
  | CloudTaskStatusUpdate
  | CloudTaskSnapshotUpdate
  | CloudTaskErrorUpdate
  | CloudTaskReconnectingUpdate
  | CloudTaskPermissionRequestUpdate;

import { SseEventParser } from "./sse-parser.ts";
import type {
  ClientConfig,
  LogEntry,
  PermissionRequestEvent,
  Task,
  TaskRun,
  TaskRunStateEvent,
  TaskRunStatus,
} from "./types.ts";

export interface CreateTaskOptions {
  description: string;
  title?: string;
  repository?: string;
  github_integration?: number | null;
}

export interface CreateTaskRunOptions {
  mode?: "interactive" | "background";
  branch?: string | null;
}

export interface StartTaskRunOptions {
  pendingUserMessage?: string;
}

export interface SendCommandOptions {
  method: "user_message" | "cancel" | "close" | "permission_response";
  params?: Record<string, unknown>;
}

export interface StreamHandlers {
  onStatus?: (event: TaskRunStateEvent) => void;
  onPermissionRequest?: (event: PermissionRequestEvent) => void;
  onLogEntry?: (entry: LogEntry) => void;
  onError?: (message: string) => void;
}

export class PostHogClient {
  private readonly config: ClientConfig;

  constructor(config: ClientConfig) {
    this.config = config;
  }

  private get baseUrl(): string {
    return this.config.apiUrl.endsWith("/")
      ? this.config.apiUrl.slice(0, -1)
      : this.config.apiUrl;
  }

  private get teamId(): number {
    return this.config.projectId;
  }

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.buildHeaders(),
        ...(options.headers as Record<string, string> | undefined),
      },
    });

    if (!response.ok) {
      let detail: string;
      try {
        const body = await response.json();
        detail = JSON.stringify(body);
      } catch {
        detail = response.statusText;
      }
      throw new Error(`[${response.status}] ${detail}`);
    }

    return response.json() as Promise<T>;
  }

  async createTask(options: CreateTaskOptions): Promise<Task> {
    return this.request<Task>(`/api/projects/${this.teamId}/tasks/`, {
      method: "POST",
      body: JSON.stringify({
        description: options.description,
        title: options.title,
        repository: options.repository,
        github_integration: options.github_integration,
        origin_product: "user_created",
      }),
    });
  }

  async createTaskRun(
    taskId: string,
    options: CreateTaskRunOptions = {},
  ): Promise<TaskRun> {
    return this.request<TaskRun>(
      `/api/projects/${this.teamId}/tasks/${taskId}/runs/`,
      {
        method: "POST",
        body: JSON.stringify({
          mode: options.mode ?? "background",
          environment: "cloud",
          ...(options.branch != null ? { branch: options.branch } : {}),
        }),
      },
    );
  }

  async startTaskRun(
    taskId: string,
    runId: string,
    options: StartTaskRunOptions = {},
  ): Promise<Task> {
    return this.request<Task>(
      `/api/projects/${this.teamId}/tasks/${taskId}/runs/${runId}/start/`,
      {
        method: "POST",
        body: JSON.stringify({
          pending_user_message: options.pendingUserMessage,
        }),
      },
    );
  }

  async getTask(taskId: string): Promise<Task> {
    return this.request<Task>(`/api/projects/${this.teamId}/tasks/${taskId}/`);
  }

  async getTaskRun(taskId: string, runId: string): Promise<TaskRun> {
    return this.request<TaskRun>(
      `/api/projects/${this.teamId}/tasks/${taskId}/runs/${runId}/`,
    );
  }

  async fetchLogs(taskId: string, runId: string): Promise<LogEntry[]> {
    const url = `${this.baseUrl}/api/projects/${this.teamId}/tasks/${taskId}/runs/${runId}/logs`;
    const response = await fetch(url, { headers: this.buildHeaders() });

    if (!response.ok) {
      if (response.status === 404) return [];
      throw new Error(`[${response.status}] ${response.statusText}`);
    }

    const text = await response.text();
    if (!text.trim()) return [];

    return text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as LogEntry);
  }

  /**
   * Opens an SSE stream for a task run and calls handlers as events arrive.
   * Resolves when the stream closes or the signal fires.
   */
  async streamEvents(
    taskId: string,
    runId: string,
    handlers: StreamHandlers,
    signal?: AbortSignal,
  ): Promise<void> {
    const url = `${this.baseUrl}/api/projects/${this.teamId}/tasks/${taskId}/runs/${runId}/stream/`;
    const response = await fetch(url, {
      headers: { ...this.buildHeaders(), Accept: "text/event-stream" },
      signal,
    });

    if (!response.ok) {
      throw new Error(
        `Stream failed: [${response.status}] ${response.statusText}`,
      );
    }

    if (!response.body) {
      throw new Error("Stream response has no body");
    }

    const parser = new SseEventParser();
    const decoder = new TextDecoder();
    const reader = response.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        const chunk = decoder.decode(value, { stream: true });
        for (const event of parser.parse(chunk)) {
          this.dispatchSseEvent(event.data, handlers);
        }
      }

      for (const event of parser.parse(decoder.decode())) {
        this.dispatchSseEvent(event.data, handlers);
      }
    } finally {
      reader.releaseLock();
    }
  }

  private dispatchSseEvent(data: unknown, handlers: StreamHandlers): void {
    if (!isObject(data)) return;

    if (isKeepalive(data)) return;

    if (isTaskRunStateEvent(data)) {
      handlers.onStatus?.(data as unknown as TaskRunStateEvent);
      return;
    }

    if (isPermissionRequestEvent(data)) {
      handlers.onPermissionRequest?.(data as unknown as PermissionRequestEvent);
      return;
    }

    if (isLogEntry(data)) {
      handlers.onLogEntry?.(data as unknown as LogEntry);
    }
  }

  async sendCommand(
    taskId: string,
    runId: string,
    options: SendCommandOptions,
  ): Promise<{ success: boolean; error?: string; result?: unknown }> {
    const url = `${this.baseUrl}/api/projects/${this.teamId}/tasks/${taskId}/runs/${runId}/command/`;
    const body = {
      jsonrpc: "2.0",
      method: options.method,
      params: options.params ?? {},
      id: `posthog-core-${Date.now()}`,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { success: false, error: text || response.statusText };
    }

    const data = (await response.json()) as {
      error?: { message?: string };
      result?: unknown;
    };
    if (data.error) {
      return {
        success: false,
        error: data.error.message ?? JSON.stringify(data.error),
      };
    }

    return { success: true, result: data.result };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isKeepalive(data: Record<string, unknown>): boolean {
  return (
    data.type === "keepalive" || ("event" in data && data.event === "keepalive")
  );
}

function isTaskRunStateEvent(data: Record<string, unknown>): boolean {
  return data.type === "task_run_state";
}

function isPermissionRequestEvent(data: Record<string, unknown>): boolean {
  return (
    data.type === "permission_request" && typeof data.requestId === "string"
  );
}

function isLogEntry(data: Record<string, unknown>): boolean {
  return data.type === "notification";
}

export function resolveRunId(task: Task): string | undefined {
  return task.latest_run?.id;
}

export function resolveRunStatus(task: Task): TaskRunStatus | undefined {
  return task.latest_run?.status;
}

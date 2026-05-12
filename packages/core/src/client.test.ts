import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostHogClient } from "./client.ts";
import type { Task, TaskRun } from "./types.ts";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const config = {
  apiUrl: "https://us.posthog.com",
  apiKey: "phx_test",
  projectId: 1,
};

function ok(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function err(status: number, body?: unknown): Response {
  return {
    ok: false,
    status,
    statusText: "Error",
    json: () => Promise.resolve(body ?? {}),
    text: () => Promise.resolve(body ? JSON.stringify(body) : ""),
  } as unknown as Response;
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Test task",
    description: "A test task",
    origin_product: "user_created",
    repository: "org/repo",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeRun(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    id: "run-1",
    task: "task-1",
    team: 1,
    branch: null,
    stage: null,
    environment: "cloud",
    status: "queued",
    log_url: "https://example.com/logs",
    error_message: null,
    output: null,
    state: {},
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    completed_at: null,
    ...overrides,
  };
}

describe("PostHogClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createTask", () => {
    it("posts to the tasks endpoint with correct body", async () => {
      const task = makeTask();
      mockFetch.mockResolvedValueOnce(ok(task));

      const client = new PostHogClient(config);
      const result = await client.createTask({
        description: "Fix the bug",
        repository: "org/repo",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://us.posthog.com/api/projects/1/tasks/");
      expect(init.method).toBe("POST");

      const body = JSON.parse(init.body as string);
      expect(body.description).toBe("Fix the bug");
      expect(body.repository).toBe("org/repo");
      expect(body.origin_product).toBe("user_created");

      expect(result).toEqual(task);
    });

    it("throws on non-ok response", async () => {
      mockFetch.mockResolvedValueOnce(err(422, { detail: "invalid" }));

      const client = new PostHogClient(config);
      await expect(client.createTask({ description: "bad" })).rejects.toThrow(
        "[422]",
      );
    });
  });

  describe("createTaskRun", () => {
    it("posts to the runs endpoint with cloud environment", async () => {
      const run = makeRun();
      mockFetch.mockResolvedValueOnce(ok(run));

      const client = new PostHogClient(config);
      await client.createTaskRun("task-1");

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        "https://us.posthog.com/api/projects/1/tasks/task-1/runs/",
      );

      const body = JSON.parse(init.body as string);
      expect(body.environment).toBe("cloud");
      expect(body.mode).toBe("background");
    });

    it("passes branch when provided", async () => {
      mockFetch.mockResolvedValueOnce(ok(makeRun()));

      const client = new PostHogClient(config);
      await client.createTaskRun("task-1", { branch: "my-branch" });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.branch).toBe("my-branch");
    });
  });

  describe("startTaskRun", () => {
    it("posts to the start endpoint with pending message", async () => {
      mockFetch.mockResolvedValueOnce(ok(makeTask()));

      const client = new PostHogClient(config);
      await client.startTaskRun("task-1", "run-1", {
        pendingUserMessage: "Fix the login bug",
      });

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        "https://us.posthog.com/api/projects/1/tasks/task-1/runs/run-1/start/",
      );
      const body = JSON.parse(init.body as string);
      expect(body.pending_user_message).toBe("Fix the login bug");
    });
  });

  describe("getTask", () => {
    it("fetches the task by id", async () => {
      const task = makeTask();
      mockFetch.mockResolvedValueOnce(ok(task));

      const client = new PostHogClient(config);
      const result = await client.getTask("task-1");

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toBe("https://us.posthog.com/api/projects/1/tasks/task-1/");
      expect(result).toEqual(task);
    });
  });

  describe("getTaskRun", () => {
    it("fetches the run by task and run id", async () => {
      const run = makeRun({ status: "in_progress" });
      mockFetch.mockResolvedValueOnce(ok(run));

      const client = new PostHogClient(config);
      const result = await client.getTaskRun("task-1", "run-1");

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toBe(
        "https://us.posthog.com/api/projects/1/tasks/task-1/runs/run-1/",
      );
      expect(result.status).toBe("in_progress");
    });
  });

  describe("fetchLogs", () => {
    it("parses NDJSON lines from the logs endpoint", async () => {
      const lines = [
        JSON.stringify({
          type: "notification",
          notification: { method: "session/update" },
        }),
        JSON.stringify({
          type: "notification",
          notification: { method: "_posthog/status" },
        }),
      ].join("\n");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(lines),
      } as unknown as Response);

      const client = new PostHogClient(config);
      const logs = await client.fetchLogs("task-1", "run-1");

      expect(logs).toHaveLength(2);
      expect(logs[0].notification?.method).toBe("session/update");
      expect(logs[1].notification?.method).toBe("_posthog/status");
    });

    it("returns empty array for 404", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: () => Promise.resolve(""),
      } as unknown as Response);

      const client = new PostHogClient(config);
      const logs = await client.fetchLogs("task-1", "run-1");
      expect(logs).toEqual([]);
    });

    it("returns empty array for empty log body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(""),
      } as unknown as Response);

      const client = new PostHogClient(config);
      const logs = await client.fetchLogs("task-1", "run-1");
      expect(logs).toEqual([]);
    });
  });

  describe("sendCommand", () => {
    it("sends a JSON-RPC user_message command", async () => {
      mockFetch.mockResolvedValueOnce(ok({ result: null }));

      const client = new PostHogClient(config);
      const result = await client.sendCommand("task-1", "run-1", {
        method: "user_message",
        params: { text: "Hello agent" },
      });

      expect(result.success).toBe(true);

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/runs/run-1/command/");

      const body = JSON.parse(init.body as string);
      expect(body.jsonrpc).toBe("2.0");
      expect(body.method).toBe("user_message");
      expect(body.params.text).toBe("Hello agent");
    });

    it("sends a permission_response command", async () => {
      mockFetch.mockResolvedValueOnce(ok({ result: { resolved: true } }));

      const client = new PostHogClient(config);
      const result = await client.sendCommand("task-1", "run-1", {
        method: "permission_response",
        params: { requestId: "req-abc", optionId: "opt-0" },
      });

      expect(result.success).toBe(true);
    });

    it("returns success:false on non-ok response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: () => Promise.resolve("bad input"),
      } as unknown as Response);

      const client = new PostHogClient(config);
      const result = await client.sendCommand("task-1", "run-1", {
        method: "cancel",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("bad input");
    });

    it("returns success:false when JSON-RPC response contains error", async () => {
      mockFetch.mockResolvedValueOnce(
        ok({ error: { message: "No pending permission" } }),
      );

      const client = new PostHogClient(config);
      const result = await client.sendCommand("task-1", "run-1", {
        method: "permission_response",
        params: { requestId: "stale", optionId: "opt-0" },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("No pending permission");
    });
  });

  describe("streamEvents", () => {
    it("calls onStatus for task_run_state events", async () => {
      const sseData =
        'data: {"type":"task_run_state","status":"in_progress","stage":"build"}\n\n';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: makeReadableStream(sseData),
      } as unknown as Response);

      const onStatus = vi.fn();
      const client = new PostHogClient(config);
      await client.streamEvents("task-1", "run-1", { onStatus });

      expect(onStatus).toHaveBeenCalledWith({
        type: "task_run_state",
        status: "in_progress",
        stage: "build",
      });
    });

    it("calls onPermissionRequest for permission_request events", async () => {
      const event = {
        type: "permission_request",
        requestId: "req-1",
        toolCall: { toolCallId: "tc-1", title: "Edit file", kind: "edit" },
        options: [{ optionId: "opt-0", label: "Allow", kind: "allow_once" }],
      };
      const sseData = `data: ${JSON.stringify(event)}\n\n`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: makeReadableStream(sseData),
      } as unknown as Response);

      const onPermissionRequest = vi.fn();
      const client = new PostHogClient(config);
      await client.streamEvents("task-1", "run-1", { onPermissionRequest });

      expect(onPermissionRequest).toHaveBeenCalledWith(event);
    });

    it("calls onLogEntry for notification events", async () => {
      const entry = {
        type: "notification",
        timestamp: "2024-01-01T00:00:00Z",
        notification: { method: "session/update" },
      };
      const sseData = `data: ${JSON.stringify(entry)}\n\n`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: makeReadableStream(sseData),
      } as unknown as Response);

      const onLogEntry = vi.fn();
      const client = new PostHogClient(config);
      await client.streamEvents("task-1", "run-1", { onLogEntry });

      expect(onLogEntry).toHaveBeenCalledWith(entry);
    });

    it("ignores keepalive events", async () => {
      const sseData =
        ': keepalive\n\ndata: {"type":"task_run_state","status":"completed"}\n\n';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: makeReadableStream(sseData),
      } as unknown as Response);

      const onStatus = vi.fn();
      const onLogEntry = vi.fn();
      const client = new PostHogClient(config);
      await client.streamEvents("task-1", "run-1", { onStatus, onLogEntry });

      expect(onStatus).toHaveBeenCalledTimes(1);
      expect(onLogEntry).not.toHaveBeenCalled();
    });

    it("throws on non-ok stream response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      } as unknown as Response);

      const client = new PostHogClient(config);
      await expect(client.streamEvents("task-1", "run-1", {})).rejects.toThrow(
        "Stream failed: [401]",
      );
    });
  });
});

function makeReadableStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    },
  });
}

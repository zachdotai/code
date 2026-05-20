import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    scope: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

import type { AuthService } from "../auth/service";
import { CloudTaskClient } from "./cloud-task-client";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers,
  });
}

function textResponse(text: string, init: ResponseInit): Response {
  return new Response(text, init);
}

function createAuthMock(projectId: number | null = 123): AuthService {
  return {
    getValidAccessToken: vi.fn(async () => ({
      apiHost: "https://app.posthog.test",
      accessToken: "token",
    })),
    getState: vi.fn(() => ({
      status: "authenticated",
      bootstrapComplete: true,
      cloudRegion: "us",
      projectId,
      availableProjectIds: projectId === null ? [] : [projectId],
      availableOrgIds: [],
      hasCodeAccess: true,
      needsScopeReauth: false,
    })),
    authenticatedFetch: vi.fn(async () => jsonResponse({})),
  } as unknown as AuthService;
}

describe("CloudTaskClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates task runs with hedgemony runtime and permission settings", async () => {
    const auth = createAuthMock(42);
    (auth.authenticatedFetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ id: "run-1", status: "not_started" }),
    );
    const client = new CloudTaskClient(auth);

    await client.createTaskRun("task-1", {
      environment: "cloud",
      mode: "background",
      branch: "feature/work",
      runtimeAdapter: "codex",
      model: "gpt-5.5",
      reasoningEffort: "high",
      initialPermissionMode: "full-access",
      prAuthorshipMode: "bot",
    });

    expect(auth.authenticatedFetch).toHaveBeenCalledWith(
      fetch,
      "https://app.posthog.test/api/projects/42/tasks/task-1/runs/",
      expect.objectContaining({ method: "POST" }),
    );
    const init = (auth.authenticatedFetch as ReturnType<typeof vi.fn>).mock
      .calls[0][2] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      environment: "cloud",
      mode: "background",
      branch: "feature/work",
      runtime_adapter: "codex",
      model: "gpt-5.5",
      reasoning_effort: "high",
      initial_permission_mode: "full-access",
      pr_authorship_mode: "bot",
    });
  });

  it("uses auth project id without fetching the current user", async () => {
    const auth = createAuthMock(77);
    (auth.authenticatedFetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ id: "task-1", latest_run: null }),
    );
    const client = new CloudTaskClient(auth);

    await client.getTaskWithLatestRun("task-1");

    expect(auth.authenticatedFetch).toHaveBeenCalledTimes(1);
    expect(auth.authenticatedFetch).toHaveBeenCalledWith(
      fetch,
      "https://app.posthog.test/api/projects/77/tasks/task-1/",
    );
  });

  it("caches the current-user team id when auth state has no project id", async () => {
    const auth = createAuthMock(null);
    let currentTeamId = 1;
    (auth.authenticatedFetch as ReturnType<typeof vi.fn>).mockImplementation(
      async (_fetch: typeof fetch, url: string) => {
        if (url.endsWith("/api/users/@me/")) {
          return jsonResponse({ team: { id: currentTeamId } });
        }
        return jsonResponse({ id: "task", latest_run: null });
      },
    );
    const client = new CloudTaskClient(auth);

    await client.getTaskWithLatestRun("task-1");
    currentTeamId = 2;
    await client.getTaskWithLatestRun("task-2");

    const urls = (
      auth.authenticatedFetch as ReturnType<typeof vi.fn>
    ).mock.calls.map((call) => call[1]);
    expect(urls).toEqual([
      "https://app.posthog.test/api/users/@me/",
      "https://app.posthog.test/api/projects/1/tasks/task-1/",
      "https://app.posthog.test/api/projects/1/tasks/task-2/",
    ]);
  });

  it("deletes tasks through the resolved project", async () => {
    const auth = createAuthMock(42);
    (auth.authenticatedFetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    const client = new CloudTaskClient(auth);

    await client.deleteTask("task-1");

    expect(auth.authenticatedFetch).toHaveBeenCalledWith(
      fetch,
      "https://app.posthog.test/api/projects/42/tasks/task-1/",
      { method: "DELETE" },
    );
  });

  it("fetches task run session logs with pagination metadata", async () => {
    const auth = createAuthMock(42);
    (auth.authenticatedFetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(
        [
          {
            type: "notification",
            timestamp: "2026-05-13T00:00:00Z",
            notification: {
              jsonrpc: "2.0",
              method: "_posthog/turn_complete",
            },
          },
        ],
        { headers: { "X-Has-More": "true" } },
      ),
    );
    const client = new CloudTaskClient(auth);

    await expect(
      client.getTaskRunSessionLogs({
        taskId: "task-1",
        runId: "run-1",
        offset: 200,
        limit: 50,
      }),
    ).resolves.toMatchObject({
      hasMore: true,
      entries: [
        expect.objectContaining({
          type: "notification",
          timestamp: "2026-05-13T00:00:00Z",
        }),
      ],
    });
    expect(auth.authenticatedFetch).toHaveBeenCalledWith(
      fetch,
      "https://app.posthog.test/api/projects/42/tasks/task-1/runs/run-1/session_logs/?limit=50&offset=200",
    );
  });

  it("injects hedgehog prompts through the cloud run command endpoint", async () => {
    const auth = createAuthMock(42);
    (auth.authenticatedFetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ jsonrpc: "2.0", id: "hedgemony-1", result: {} }),
    );
    const client = new CloudTaskClient(auth);

    await expect(
      client.injectPrompt({
        taskId: "task-1",
        taskRunId: "run-1",
        prompt: "Status?",
        authoredBy: "hedgehog",
      }),
    ).resolves.toEqual({ accepted: true, processed: "unknown" });

    expect(auth.authenticatedFetch).toHaveBeenCalledWith(
      fetch,
      "https://app.posthog.test/api/projects/42/tasks/task-1/runs/run-1/command/",
      expect.objectContaining({ method: "POST" }),
    );
    const init = (auth.authenticatedFetch as ReturnType<typeof vi.fn>).mock
      .calls[0][2] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      jsonrpc: "2.0",
      method: "user_message",
      params: {
        content:
          "Message from the Hedgemony hedgehog orchestrating this nest:\n\nStatus?",
      },
      id: expect.stringMatching(/^hedgemony-hedgehog-/),
    });
  });

  it("reports unavailable runs when prompt injection cannot find an active run", async () => {
    const auth = createAuthMock(42);
    (auth.authenticatedFetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      textResponse("No active session for this run", { status: 400 }),
    );
    const client = new CloudTaskClient(auth);

    await expect(
      client.injectPrompt({
        taskId: "task-1",
        taskRunId: "run-1",
        prompt: "Status?",
        authoredBy: "hedgehog",
      }),
    ).resolves.toMatchObject({
      accepted: false,
      reason: "run_unavailable",
    });
  });

  it("reports command-level injection rejections", async () => {
    const auth = createAuthMock(42);
    (auth.authenticatedFetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        jsonrpc: "2.0",
        id: "hedgemony-1",
        error: { message: "Agent is busy" },
      }),
    );
    const client = new CloudTaskClient(auth);

    await expect(
      client.injectPrompt({
        taskId: "task-1",
        taskRunId: "run-1",
        prompt: "Status?",
        authoredBy: "hedgehog",
      }),
    ).resolves.toEqual({
      accepted: false,
      reason: "rejected",
      message: "Agent is busy",
    });
  });

  it.each([
    [{ processed: "active" }, "active"],
    [{ result: { processed: "queued" } }, "queued"],
    [{ result: {} }, "unknown"],
  ] as const)(
    "reports prompt processing state %#",
    async (responseBody, expectedProcessed) => {
      const auth = createAuthMock(42);
      (auth.authenticatedFetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ jsonrpc: "2.0", id: "hedgemony-1", ...responseBody }),
      );
      const client = new CloudTaskClient(auth);

      await expect(
        client.injectPrompt({
          taskId: "task-1",
          taskRunId: "run-1",
          prompt: "Status?",
          authoredBy: "hedgehog",
        }),
      ).resolves.toEqual({
        accepted: true,
        processed: expectedProcessed,
      });
    },
  );

  it("lists accessible repository slugs from the integration cache", async () => {
    const auth = createAuthMock(42);
    (auth.authenticatedFetch as ReturnType<typeof vi.fn>).mockImplementation(
      async (_fetch: typeof fetch, url: string) => {
        if (url.endsWith("/api/users/@me/integrations/")) {
          return jsonResponse({
            results: [{ id: "integration-1", installation_id: "install-1" }],
          });
        }
        if (
          url.endsWith(
            "/api/users/@me/integrations/github/install-1/repos/?limit=500",
          )
        ) {
          return jsonResponse({
            results: ["PostHog/posthog", "Brooker-Fam/nexus-games"],
          });
        }
        return jsonResponse({});
      },
    );
    const client = new CloudTaskClient(auth);

    await expect(client.listAccessibleRepositorySlugs()).resolves.toEqual([
      "PostHog/posthog",
      "Brooker-Fam/nexus-games",
    ]);
  });

  it("throws on non-OK task creation responses", async () => {
    const auth = createAuthMock(42);
    (auth.authenticatedFetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      textResponse("bad request", { status: 400, statusText: "Bad Request" }),
    );
    const client = new CloudTaskClient(auth);

    await expect(
      client.createTask({ title: "title", description: "description" }),
    ).rejects.toThrow("create_task_failed: HTTP 400");
  });
});

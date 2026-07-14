import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostHogAPIClient } from "./posthog-api";

const mockFetch = vi.fn();

vi.stubGlobal("fetch", mockFetch);

describe("PostHogAPIClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes once when fetching task run logs gets an auth failure", async () => {
    const getApiKey = vi.fn().mockResolvedValue("stale-token");
    const refreshApiKey = vi.fn().mockResolvedValue("fresh-token");
    const client = new PostHogAPIClient({
      apiUrl: "https://app.posthog.com",
      getApiKey,
      refreshApiKey,
      projectId: 1,
    });

    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      })
      .mockResolvedValueOnce({
        ok: true,
        text: vi
          .fn()
          .mockResolvedValue(
            `${JSON.stringify({ type: "notification", notification: { method: "foo" } })}\n`,
          ),
      });

    const logs = await client.fetchTaskRunLogs({
      id: "run-1",
      task: "task-1",
    } as never);

    expect(logs).toHaveLength(1);
    expect(getApiKey).toHaveBeenCalledTimes(1);
    expect(refreshApiKey).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("downloads artifacts through the backend endpoint", async () => {
    const client = new PostHogAPIClient({
      apiUrl: "https://app.posthog.com",
      getApiKey: vi.fn().mockResolvedValue("token"),
      projectId: 7,
    });
    const bytes = new TextEncoder().encode("hello world");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer),
    });

    const artifact = await client.downloadArtifact(
      "task-1",
      "run-1",
      "tasks/artifacts/team_1/task_task-1/run_run-1/file.txt",
    );

    expect(artifact).toEqual(bytes.buffer);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://app.posthog.com/api/projects/7/tasks/task-1/runs/run-1/artifacts/download/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          storage_path: "tasks/artifacts/team_1/task_task-1/run_run-1/file.txt",
        }),
        headers: expect.any(Headers),
      }),
    );
  });

  it("retries a transiently-unreadable artifact download before returning it", async () => {
    vi.useFakeTimers();
    try {
      const client = new PostHogAPIClient({
        apiUrl: "https://app.posthog.com",
        getApiKey: vi.fn().mockResolvedValue("token"),
        projectId: 7,
      });
      const bytes = new TextEncoder().encode("pasted body");

      // First read 404s (object not visible yet right after upload), then the
      // retry succeeds — mirroring read-after-write lag on the first cloud turn.
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: "Not Found",
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer),
        });

      const resultPromise = client.downloadArtifact(
        "task-1",
        "run-1",
        "tasks/artifacts/pasted-text.txt",
      );
      await vi.runAllTimersAsync();
      const artifact = await resultPromise;

      expect(artifact).toEqual(bytes.buffer);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns null once the artifact download retry budget is exhausted", async () => {
    vi.useFakeTimers();
    try {
      const client = new PostHogAPIClient({
        apiUrl: "https://app.posthog.com",
        getApiKey: vi.fn().mockResolvedValue("token"),
        projectId: 7,
      });

      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      const resultPromise = client.downloadArtifact(
        "task-1",
        "run-1",
        "tasks/artifacts/pasted-text.txt",
      );
      await vi.runAllTimersAsync();
      const artifact = await resultPromise;

      expect(artifact).toBeNull();
      expect(mockFetch.mock.calls.length).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns only the artifacts created by the current upload request", async () => {
    const client = new PostHogAPIClient({
      apiUrl: "https://app.posthog.com",
      getApiKey: vi.fn().mockResolvedValue("token"),
      projectId: 1,
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        artifacts: [
          { storage_path: "gs://bucket/existing.tar.gz", name: "existing" },
          { storage_path: "gs://bucket/new-1.pack", name: "new-1" },
          { storage_path: "gs://bucket/new-2.index", name: "new-2" },
        ],
      }),
    });

    const artifacts = await client.uploadTaskArtifacts("task-1", "run-1", [
      { name: "new-1", type: "artifact", content: "AAA" },
      { name: "new-2", type: "artifact", content: "BBB" },
    ]);

    expect(artifacts).toEqual([
      { storage_path: "gs://bucket/new-1.pack", name: "new-1" },
      { storage_path: "gs://bucket/new-2.index", name: "new-2" },
    ]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AcpConnectionConfig } from "./adapters/acp-connection";

const createAcpConnectionMock = vi.hoisted(() =>
  vi.fn(() => ({ cleanup: vi.fn() }) as never),
);

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("./adapters/acp-connection", () => {
  return {
    createAcpConnection: createAcpConnectionMock,
  };
});

import { Agent } from "./agent";

describe("Agent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [{ id: "gpt-5.5", owned_by: "openai" }],
      }),
    });
  });

  it("passes reasoning effort through to local Codex options", async () => {
    const agent = new Agent({
      posthog: {
        apiUrl: "https://us.posthog.com",
        getApiKey: vi.fn().mockResolvedValue("token"),
        projectId: 1,
      },
      skipLogPersistence: true,
    });

    await agent.run("task-1", "run-1", {
      adapter: "codex",
      model: "gpt-5.5",
      reasoningEffort: "xhigh",
      repositoryPath: "/tmp/repo",
    });

    expect(createAcpConnectionMock).toHaveBeenCalledTimes(1);
    const [[config]] = createAcpConnectionMock.mock.calls as unknown as [
      [AcpConnectionConfig],
    ];
    expect(config.codexOptions).toEqual(
      expect.objectContaining({
        model: "gpt-5.5",
        reasoningEffort: "xhigh",
      }),
    );
  });

  it("passes gateway config and model allow-list through to the hog adapter", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [
          { id: "claude-haiku-4-5", owned_by: "anthropic" },
          { id: "gpt-5.5", owned_by: "openai" },
        ],
      }),
    });

    const agent = new Agent({
      posthog: {
        apiUrl: "https://us.posthog.com",
        getApiKey: vi.fn().mockResolvedValue("token"),
        projectId: 1,
      },
      skipLogPersistence: true,
    });

    await agent.run("task-1", "run-1", {
      adapter: "hog",
      model: "gpt-5.5",
      repositoryPath: "/tmp/repo",
    });

    expect(createAcpConnectionMock).toHaveBeenCalledTimes(1);
    const [[config]] = createAcpConnectionMock.mock.calls as unknown as [
      [AcpConnectionConfig],
    ];
    expect(config.hogGateway).toEqual(
      expect.objectContaining({
        gatewayUrl: "https://gateway.us.posthog.com/posthog_code",
        apiKey: "token",
      }),
    );
    expect(config.allowedModelIds).toEqual(new Set(["gpt-5.5"]));
  });
});

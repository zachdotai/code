import type { AgentSession } from "@posthog/shared";
import { describe, expect, it, vi } from "vitest";
import { SessionService, type SessionServiceDeps } from "./sessionService";

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    taskRunId: "run-1",
    taskId: "task-1",
    taskTitle: "Test task",
    channel: "",
    events: [],
    startedAt: 1,
    status: "error",
    isPromptPending: false,
    isCompacting: false,
    promptStartedAt: null,
    pendingPermissions: new Map(),
    pausedDurationMs: 0,
    messageQueue: [],
    optimisticItems: [],
    initialPrompt: [{ type: "text", text: "Ship the fix" }],
    ...overrides,
  } as AgentSession;
}

function createHarness(session: AgentSession) {
  const sessions: Record<string, AgentSession> = {
    [session.taskRunId]: session,
  };
  const deps = {
    store: {
      getSessionByTaskId: (taskId: string) =>
        Object.values(sessions).find((s) => s.taskId === taskId),
    },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    trpc: {
      agent: {
        onSessionIdleKilled: {
          subscribe: () => ({ unsubscribe: vi.fn() }),
        },
      },
    },
  } as unknown as SessionServiceDeps;

  const service = new SessionService(deps);
  vi.spyOn(
    service as unknown as { teardownSession: () => Promise<void> },
    "teardownSession",
  ).mockResolvedValue(undefined);
  vi.spyOn(
    service as unknown as {
      getAuthCredentialsStatus: () => Promise<unknown>;
    },
    "getAuthCredentialsStatus",
  ).mockResolvedValue({ kind: "ready", auth: { client: {} } });
  const createNewLocalSession = vi
    .spyOn(
      service as unknown as {
        createNewLocalSession: (...args: unknown[]) => Promise<void>;
      },
      "createNewLocalSession",
    )
    .mockResolvedValue(undefined);

  return { service, createNewLocalSession };
}

describe("SessionService.clearSessionError retry config", () => {
  it("recreates the session with the original run configuration", async () => {
    const session = makeSession({
      model: "claude-fable-5",
      adapter: "claude",
      executionMode: "auto",
      reasoningLevel: "high",
    });
    const { service, createNewLocalSession } = createHarness(session);

    await service.clearSessionError("task-1", "/repo");

    expect(createNewLocalSession).toHaveBeenCalledWith(
      "task-1",
      "Test task",
      "/repo",
      { client: {} },
      session.initialPrompt,
      "auto", // executionMode
      "claude", // adapter
      "claude-fable-5", // model
      "high", // reasoningLevel
    );
  });
});

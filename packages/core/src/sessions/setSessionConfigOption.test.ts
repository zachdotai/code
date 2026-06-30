import type { AgentSession } from "@posthog/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionService, type SessionServiceDeps } from "./sessionService";

const TASK_ID = "task-1";
const RUN_ID = "run-1";
const MODEL_OPTION_ID = "model";

function cloudSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    taskId: TASK_ID,
    taskRunId: RUN_ID,
    isCloud: true,
    cloudStatus: "in_progress",
    status: "connected",
    configOptions: [
      { id: MODEL_OPTION_ID, currentValue: "sonnet" },
    ] as AgentSession["configOptions"],
    events: [],
    pendingPermissions: new Map(),
    messageQueue: [],
    optimisticItems: [],
    pausedDurationMs: 0,
    isPromptPending: false,
    isCompacting: false,
    promptStartedAt: null,
    ...overrides,
  } as AgentSession;
}

function createHarness(session: AgentSession) {
  const sessions: Record<string, AgentSession> = {
    [session.taskRunId]: session,
  };
  const sendCommand = vi.fn().mockResolvedValue({ success: true, result: {} });
  const deps = {
    store: {
      getSessions: () => sessions,
      getSessionByTaskId: (taskId: string) =>
        Object.values(sessions).find((s) => s.taskId === taskId),
      updateSession: (taskRunId: string, updates: Partial<AgentSession>) => {
        const s = sessions[taskRunId];
        if (s) Object.assign(s, updates);
      },
    },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    toast: { error: vi.fn() },
    updatePersistedConfigOptionValue: vi.fn(),
    fetchAuthState: vi
      .fn()
      .mockResolvedValue({ cloudRegion: "us", currentProjectId: 1 }),
    trpc: {
      agent: {
        onSessionIdleKilled: { subscribe: () => ({ unsubscribe: vi.fn() }) },
      },
      cloudTask: { sendCommand: { mutate: sendCommand } },
    },
  } as unknown as SessionServiceDeps;

  return { service: new SessionService(deps), sendCommand, sessions };
}

describe("setSessionConfigOption cloud buffering", () => {
  let session: AgentSession;

  beforeEach(() => {
    session = cloudSession();
  });

  it("buffers the change without dispatching while the agent is idle between turns", async () => {
    session.agentIdleForRunId = RUN_ID;
    const { service, sendCommand, sessions } = createHarness(session);

    await service.setSessionConfigOption(TASK_ID, MODEL_OPTION_ID, "opus");

    expect(sendCommand).not.toHaveBeenCalled();
    expect(sessions[RUN_ID].pendingConfigChanges).toEqual({
      [MODEL_OPTION_ID]: "opus",
    });
    // Picker still reflects the new value optimistically.
    expect(sessions[RUN_ID].configOptions?.[0].currentValue).toBe("opus");
  });

  it("dispatches immediately while the agent is mid-turn", async () => {
    session.agentIdleForRunId = undefined;
    const { service, sendCommand, sessions } = createHarness(session);

    await service.setSessionConfigOption(TASK_ID, MODEL_OPTION_ID, "opus");

    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "set_config_option",
        params: { configId: MODEL_OPTION_ID, value: "opus" },
      }),
    );
    expect(sessions[RUN_ID].pendingConfigChanges).toBeUndefined();
  });
});

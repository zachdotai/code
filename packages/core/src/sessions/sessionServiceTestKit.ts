import type { AgentSession } from "@posthog/shared";
import { vi } from "vitest";
import type { SessionServiceDeps } from "./sessionService";

export function makeAgentSession(
  taskId: string,
  overrides: Partial<AgentSession> = {},
): AgentSession {
  return {
    taskRunId: `run-${taskId}`,
    taskId,
    taskTitle: taskId,
    channel: "",
    events: [],
    startedAt: 1,
    status: "connected",
    isPromptPending: false,
    isCompacting: false,
    promptStartedAt: null,
    pendingPermissions: new Map(),
    pausedDurationMs: 0,
    messageQueue: [],
    optimisticItems: [],
    ...overrides,
  } as AgentSession;
}

export function makeSessionServiceDeps(
  sessions: Record<string, AgentSession> = {},
) {
  const removeSession = vi.fn((taskRunId: string) => {
    delete sessions[taskRunId];
  });
  const cancelMutate = vi.fn().mockResolvedValue(undefined);
  const removePersistedConfigOptions = vi.fn();
  const removeAdapter = vi.fn();
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const deps = {
    store: {
      getSessions: () => sessions,
      getSessionByTaskId: (taskId: string) =>
        Object.values(sessions).find((s) => s.taskId === taskId),
      removeSession,
      updateSession: vi.fn(),
    },
    log,
    getPersistedConfigOptions: () => undefined,
    setPersistedConfigOptions: vi.fn(),
    removePersistedConfigOptions,
    adapterStore: {
      getAdapter: () => undefined,
      setAdapter: vi.fn(),
      removeAdapter,
    },
    trpc: {
      agent: {
        cancel: { mutate: cancelMutate },
        onSessionIdleKilled: {
          subscribe: () => ({ unsubscribe: vi.fn() }),
        },
      },
    },
  } as unknown as SessionServiceDeps;

  return {
    deps,
    sessions,
    log,
    removeSession,
    cancelMutate,
    removePersistedConfigOptions,
    removeAdapter,
  };
}

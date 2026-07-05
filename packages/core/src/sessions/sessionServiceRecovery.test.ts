import type { AgentSession } from "@posthog/shared";
import type { Task } from "@posthog/shared/domain-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ReconcileTaskConnectionParams,
  SessionService,
  type SessionServiceDeps,
} from "./sessionService";

const IN_FLIGHT_TTL_MS = 10 * 60 * 1000;

function makeSession(taskId: string): AgentSession {
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
  } as AgentSession;
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Test task",
    description: "Ship the fix",
    latest_run: null,
    ...overrides,
  } as Task;
}

function createHarness({ spyConnect = true } = {}) {
  const sessions: Record<string, AgentSession> = {};
  const store = {
    getSessions: () => sessions,
    getSessionByTaskId: (taskId: string) =>
      Object.values(sessions).find((s) => s.taskId === taskId),
    removeSession: vi.fn(),
    updateSession: vi.fn(),
  };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  let emitStalledTurn:
    | ((event: { taskRunId: string; taskId: string }) => void)
    | undefined;
  const deps = {
    store,
    log,
    getPersistedConfigOptions: () => undefined,
    setPersistedConfigOptions: vi.fn(),
    removePersistedConfigOptions: vi.fn(),
    adapterStore: {
      getAdapter: () => undefined,
      setAdapter: vi.fn(),
      removeAdapter: vi.fn(),
    },
    trpc: {
      agent: {
        cancel: { mutate: vi.fn().mockResolvedValue(undefined) },
        onSessionIdleKilled: {
          subscribe: () => ({ unsubscribe: vi.fn() }),
        },
        onSessionStalled: {
          subscribe: (
            _input: unknown,
            handlers: {
              onData: (event: { taskRunId: string; taskId: string }) => void;
            },
          ) => {
            emitStalledTurn = handlers.onData;
            return { unsubscribe: vi.fn() };
          },
        },
      },
    },
  } as unknown as SessionServiceDeps;

  const service = new SessionService(deps);
  const connectToTask = spyConnect
    ? vi.spyOn(service, "connectToTask").mockResolvedValue(undefined)
    : undefined;
  return {
    service,
    sessions,
    connectToTask,
    log,
    emitStalledTurn: (event: { taskRunId: string; taskId: string }) => {
      if (!emitStalledTurn) throw new Error("Stalled-turn handler not wired");
      emitStalledTurn(event);
    },
  };
}

function reconcile(
  service: SessionService,
  task: Task,
  session?: AgentSession,
): () => void {
  return service.reconcileTaskConnection({
    task,
    session,
    repoPath: "/repo",
    isCloud: false,
    isOnline: true,
    cloudAuth: { status: "loading" },
  } as ReconcileTaskConnectionParams);
}

describe("SessionService run-less local task recovery", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    {
      case: "sends the description as the initial prompt",
      description: "Ship the fix",
      initialPrompt: [{ type: "text", text: "Ship the fix" }],
    },
    {
      case: "connects without a prompt when the description is empty",
      description: "",
      initialPrompt: undefined,
    },
  ])("starts a first run and $case", ({ description, initialPrompt }) => {
    const { service, connectToTask } = createHarness();
    const task = makeTask({ description });

    reconcile(service, task);

    const expected: Record<string, unknown> = { task, repoPath: "/repo" };
    if (initialPrompt) {
      expected.initialPrompt = initialPrompt;
    }
    expect(connectToTask).toHaveBeenCalledWith(expected);
  });

  it("recovers a run-less task whose session is disconnected", () => {
    const { service, connectToTask } = createHarness();
    const task = makeTask();
    const session = {
      ...makeSession(task.id),
      status: "disconnected" as const,
    };

    reconcile(service, task, session);

    expect(connectToTask).toHaveBeenCalledWith({
      task,
      repoPath: "/repo",
      initialPrompt: [{ type: "text", text: "Ship the fix" }],
    });
  });

  it("does not recover while a session is connecting", () => {
    const { service, connectToTask } = createHarness();
    const task = makeTask();
    const session = { ...makeSession(task.id), status: "connecting" as const };

    reconcile(service, task, session);

    expect(connectToTask).not.toHaveBeenCalled();
  });

  it("defers to an in-flight creation and recovers once the mark expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { service, connectToTask } = createHarness();
    const task = makeTask();

    service.markTaskCreationInFlight(task.id);
    reconcile(service, task);
    expect(connectToTask).not.toHaveBeenCalled();

    vi.setSystemTime(IN_FLIGHT_TTL_MS + 1);
    reconcile(service, task);
    expect(connectToTask).toHaveBeenCalledTimes(1);
  });

  it("clears the in-flight mark when a connect starts", async () => {
    const { service, sessions } = createHarness({ spyConnect: false });
    const task = makeTask();
    sessions[`run-${task.id}`] = makeSession(task.id);
    service.markTaskCreationInFlight(task.id);

    await service.connectToTask({ task, repoPath: "/repo" });

    const connectToTask = vi
      .spyOn(service, "connectToTask")
      .mockResolvedValue(undefined);
    reconcile(service, task);
    expect(connectToTask).toHaveBeenCalledTimes(1);
  });

  it("resumes an existing run without injecting a prompt", () => {
    const { service, connectToTask } = createHarness();
    const task = makeTask({
      latest_run: { id: "run-9" } as Task["latest_run"],
    });

    reconcile(service, task);

    expect(connectToTask).toHaveBeenCalledWith({ task, repoPath: "/repo" });
  });
});

describe("SessionService stalled-turn recovery", () => {
  it("auto-recovers a local session when the main process reports a stalled turn", async () => {
    const { service, sessions, emitStalledTurn } = createHarness();
    sessions["run-task-1"] = makeSession("task-1");
    (
      service as unknown as { localRepoPaths: Map<string, string> }
    ).localRepoPaths.set("task-1", "/repo");
    const reconnectInPlace = vi
      .spyOn(
        service as unknown as {
          reconnectInPlace: (taskId: string, repoPath: string) => unknown;
        },
        "reconnectInPlace",
      )
      .mockResolvedValue(true);

    emitStalledTurn({ taskId: "task-1", taskRunId: "run-task-1" });

    await vi.waitFor(() =>
      expect(reconnectInPlace).toHaveBeenCalledWith("task-1", "/repo"),
    );
  });

  it("ignores stalled-turn reports for cloud sessions", async () => {
    const { service, sessions, emitStalledTurn } = createHarness();
    sessions["run-task-1"] = { ...makeSession("task-1"), isCloud: true };
    const reconnectInPlace = vi.spyOn(
      service as unknown as {
        reconnectInPlace: (taskId: string, repoPath: string) => unknown;
      },
      "reconnectInPlace",
    );

    emitStalledTurn({ taskId: "task-1", taskRunId: "run-task-1" });
    await Promise.resolve();

    expect(reconnectInPlace).not.toHaveBeenCalled();
  });

  it("ignores stalled-turn reports for superseded runs", async () => {
    const { service, sessions, emitStalledTurn } = createHarness();
    sessions["run-task-1"] = makeSession("task-1");
    const reconnectInPlace = vi.spyOn(
      service as unknown as {
        reconnectInPlace: (taskId: string, repoPath: string) => unknown;
      },
      "reconnectInPlace",
    );

    emitStalledTurn({ taskId: "task-1", taskRunId: "run-old" });
    await Promise.resolve();

    expect(reconnectInPlace).not.toHaveBeenCalled();
  });
});

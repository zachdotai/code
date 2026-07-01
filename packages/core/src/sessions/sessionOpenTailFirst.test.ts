import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionService, type SessionServiceDeps } from "./sessionService";
import { sessionStore, sessionStoreSetters } from "./sessionStore";

const RUN = "run-tf";
const TASK = "task-tf";

function contentLine(text: string): string {
  return JSON.stringify({
    type: "notification",
    notification: {
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        },
      },
    },
  });
}

function configLine(): string {
  return JSON.stringify({
    type: "notification",
    notification: {
      method: "session/update",
      params: { update: { sessionUpdate: "config_option_update" } },
    },
  });
}

function makeService(readWindow?: unknown) {
  const logs: Record<string, unknown> = {
    readLocalLogs: { query: vi.fn().mockResolvedValue(null) },
    fetchS3Logs: { query: vi.fn().mockResolvedValue(null) },
    writeLocalLogs: { mutate: vi.fn() },
  };
  if (readWindow !== undefined)
    logs.readLocalLogsWindow = { query: readWindow };

  const deps = {
    store: sessionStoreSetters,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    notifyPromptComplete: vi.fn(),
    notifyPermissionRequest: vi.fn(),
    taskViewedApi: { markActivity: vi.fn() },
    getPersistedConfigOptions: () => undefined,
    setPersistedConfigOptions: vi.fn(),
    trpc: {
      agent: {
        onSessionEvent: { subscribe: () => ({ unsubscribe: vi.fn() }) },
        onPermissionRequest: { subscribe: () => ({ unsubscribe: vi.fn() }) },
        onSessionIdleKilled: { subscribe: () => ({ unsubscribe: vi.fn() }) },
      },
      logs,
    },
  } as unknown as SessionServiceDeps;
  return new SessionService(deps);
}

type Painter = {
  paintTailFirst(r: string, t: string, ti: string, u: string): Promise<void>;
};
const paint = (svc: SessionService) =>
  (svc as unknown as Painter).paintTailFirst(RUN, TASK, "Title", "log-url");

const events = () => sessionStore.getState().sessions[RUN]?.events ?? [];

afterEach(() => sessionStoreSetters.removeSession(RUN));

describe("paintTailFirst", () => {
  it("paints from the tail window when it already holds content", async () => {
    const readWindow = vi.fn().mockResolvedValue({
      content: `${contentLine("a")}\n${contentLine("b")}\n`,
      startOffset: 4096,
      endOffset: 8192,
      headReached: false,
    });
    await paint(makeService(readWindow));

    expect(readWindow).toHaveBeenCalledWith({
      taskRunId: RUN,
      endOffset: null,
      maxBytes: 1_500_000,
    });
    expect(readWindow).toHaveBeenCalledTimes(1);
    expect(events().length).toBeGreaterThan(0);
    expect(sessionStore.getState().sessions[RUN]?.logUrl).toBe("log-url");
  });

  it("pages back past config-noise tails until it finds real messages", async () => {
    const readWindow = vi
      .fn()
      // First (newest) window: only config noise, more history remains.
      .mockResolvedValueOnce({
        content: `${configLine()}\n${configLine()}\n`,
        startOffset: 4096,
        endOffset: 8192,
        headReached: false,
      })
      // Paged back: real content.
      .mockResolvedValueOnce({
        content: `${contentLine("older")}\n`,
        startOffset: 0,
        endOffset: 4096,
        headReached: true,
      });
    await paint(makeService(readWindow));

    expect(readWindow).toHaveBeenCalledTimes(2);
    expect(readWindow).toHaveBeenLastCalledWith({
      taskRunId: RUN,
      endOffset: 4096,
      maxBytes: 1_500_000,
    });
    // Both pages' events are painted, oldest first.
    expect(events().length).toBe(3);
  });

  it("is a no-op when the host doesn't expose the windowed read", async () => {
    await paint(makeService(undefined));
    expect(sessionStore.getState().sessions[RUN]).toBeUndefined();
  });

  it("is a no-op when a session already exists", async () => {
    const readWindow = vi.fn().mockResolvedValue({
      content: contentLine("x"),
      startOffset: 0,
      endOffset: 16,
      headReached: true,
    });
    sessionStoreSetters.setSession({
      taskRunId: RUN,
      taskId: TASK,
      events: [],
      messageQueue: [],
      pendingPermissions: new Map(),
      status: "connected",
    } as never);
    await paint(makeService(readWindow));
    expect(readWindow).not.toHaveBeenCalled();
  });

  it("is a no-op on empty window content", async () => {
    const readWindow = vi.fn().mockResolvedValue({
      content: "  ",
      startOffset: 0,
      endOffset: 2,
      headReached: true,
    });
    await paint(makeService(readWindow));
    expect(sessionStore.getState().sessions[RUN]).toBeUndefined();
  });
});

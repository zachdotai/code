import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks for side-effecting / native deps pulled in by the store ---------

const presentLocalNotification = vi.fn().mockResolvedValue(undefined);
vi.mock("@/features/notifications/lib/notifications", () => ({
  presentLocalNotification: (...args: unknown[]) =>
    presentLocalNotification(...args),
}));

const playMeepSound = vi.fn().mockResolvedValue(undefined);
vi.mock("../utils/sounds", () => ({
  playMeepSound: () => playMeepSound(),
}));

vi.mock("expo-haptics", () => ({
  notificationAsync: vi.fn(),
  NotificationFeedbackType: { Success: "success" },
}));

vi.mock("@/features/preferences/stores/preferencesStore", () => ({
  usePreferencesStore: {
    getState: () => ({ pingsEnabled: true, pushNotificationsEnabled: true }),
  },
}));

// Network/cloud APIs — never hit in these tests but imported by the module.
vi.mock("../api", () => ({
  CloudCommandError: class CloudCommandError extends Error {},
  getTask: vi.fn(),
  runTaskInCloud: vi.fn(),
  sendCloudCommand: vi.fn(),
}));

vi.mock("../lib/cloudTaskStream", () => ({
  watchCloudTask: vi.fn(),
}));

// Pulls in expo-file-system → expo-modules-core, which needs the RN-injected
// __DEV__ global; stub the module so the store loads under the node env.
vi.mock("../composer/attachments/buildCloudPrompt", () => ({
  buildCloudPromptBlocks: vi.fn(),
}));

import type { TaskSession } from "./taskSessionStore";
import { useTaskSessionStore } from "./taskSessionStore";

// Unique ids per test — maybePresentLocalNotification keeps a module-level
// per-task dedup window that would otherwise suppress later tests' pings.
let idCounter = 0;
let TASK_RUN_ID = "run-0";
let TASK_ID = "task-0";

function seedSession(overrides: Partial<TaskSession> = {}): void {
  const session: TaskSession = {
    taskRunId: TASK_RUN_ID,
    taskId: TASK_ID,
    taskTitle: "My task",
    events: [],
    status: "connected",
    isPromptPending: true,
    awaitingPing: true,
    ...overrides,
  };
  useTaskSessionStore.setState({
    sessions: { [TASK_RUN_ID]: session },
    // Not focused on this task, so the OS-banner suppression doesn't kick in.
    focusedTaskId: null,
  });
}

const recentTimestamp = () => new Date(Date.now() - 1000).toISOString();
const staleTimestamp = () =>
  new Date(Date.now() - 10 * 60 * 1000).toISOString();

describe("taskSessionStore terminal notifications", () => {
  beforeEach(() => {
    presentLocalNotification.mockClear();
    playMeepSound.mockClear();
    idCounter += 1;
    TASK_RUN_ID = `run-${idCounter}`;
    TASK_ID = `task-${idCounter}`;
    useTaskSessionStore.setState({ sessions: {}, focusedTaskId: null });
  });

  it("does NOT fire a failure notification for a cancelled run", () => {
    seedSession();
    useTaskSessionStore.getState()._handleCloudUpdate(TASK_RUN_ID, {
      taskId: TASK_ID,
      runId: TASK_RUN_ID,
      kind: "status",
      status: "cancelled",
      statusUpdatedAt: recentTimestamp(),
    });

    expect(presentLocalNotification).not.toHaveBeenCalled();
    // The run is still recorded as a distinct, non-failed terminal state.
    expect(
      useTaskSessionStore.getState().sessions[TASK_RUN_ID]?.terminalStatus,
    ).toBe("cancelled");
  });

  it("fires a failure notification for a recent failed run", () => {
    seedSession();
    useTaskSessionStore.getState()._handleCloudUpdate(TASK_RUN_ID, {
      taskId: TASK_ID,
      runId: TASK_RUN_ID,
      kind: "status",
      status: "failed",
      errorMessage: "boom",
      statusUpdatedAt: recentTimestamp(),
    });

    expect(presentLocalNotification).toHaveBeenCalledTimes(1);
    expect(presentLocalNotification.mock.calls[0][0].body).toContain("failed");
  });

  it("does NOT fire for a failed run that terminated long ago (stale reconnect)", () => {
    seedSession();
    useTaskSessionStore.getState()._handleCloudUpdate(TASK_RUN_ID, {
      taskId: TASK_ID,
      runId: TASK_RUN_ID,
      kind: "snapshot",
      newEntries: [],
      totalEntryCount: 0,
      status: "failed",
      statusUpdatedAt: staleTimestamp(),
    });

    expect(presentLocalNotification).not.toHaveBeenCalled();
    expect(
      useTaskSessionStore.getState().sessions[TASK_RUN_ID]?.terminalStatus,
    ).toBe("failed");
  });

  it("does NOT fire when the user was not awaiting a ping", () => {
    seedSession({ awaitingPing: false });
    useTaskSessionStore.getState()._handleCloudUpdate(TASK_RUN_ID, {
      taskId: TASK_ID,
      runId: TASK_RUN_ID,
      kind: "status",
      status: "failed",
      statusUpdatedAt: recentTimestamp(),
    });

    expect(presentLocalNotification).not.toHaveBeenCalled();
  });

  it("fires a completion notification for a recent completed run", () => {
    seedSession();
    useTaskSessionStore.getState()._handleCloudUpdate(TASK_RUN_ID, {
      taskId: TASK_ID,
      runId: TASK_RUN_ID,
      kind: "status",
      status: "completed",
      statusUpdatedAt: recentTimestamp(),
    });

    expect(presentLocalNotification).toHaveBeenCalledTimes(1);
    expect(presentLocalNotification.mock.calls[0][0].body).toContain(
      "finished",
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  type DeriveTaskDataContext,
  deriveTaskData,
  type SidebarTask,
  type TaskSession,
} from "./buildSidebarData";

function makeTask(overrides: Partial<SidebarTask> = {}): SidebarTask {
  return {
    id: "task-1",
    title: "Build React canvas",
    created_at: "2026-06-22T00:00:00.000Z",
    updated_at: "2026-06-22T00:01:00.000Z",
    latest_run: { status: "in_progress", environment: "cloud" },
    ...overrides,
  };
}

function makeCtx(session: TaskSession | undefined): DeriveTaskDataContext {
  return {
    session,
    workspace: undefined,
    timestamp: undefined,
    pinnedIds: new Set(),
    suspendedIds: new Set(),
    slackTaskIds: new Set(),
    slackThreadUrlByTaskId: new Map(),
  };
}

describe("deriveTaskData cloud run status", () => {
  it("keeps the raw status when there is no live session", () => {
    const data = deriveTaskData(makeTask(), makeCtx(undefined));
    expect(data.taskRunStatus).toBe("in_progress");
  });

  it("keeps in_progress when the agent has not gone idle for this run", () => {
    const data = deriveTaskData(
      makeTask(),
      makeCtx({ cloudStatus: "in_progress", taskRunId: "run-1" }),
    );
    expect(data.taskRunStatus).toBe("in_progress");
  });

  it("treats a stuck non-terminal run as completed once the agent goes idle", () => {
    // Backend status never flipped to terminal, but turn_complete fired.
    const data = deriveTaskData(
      makeTask(),
      makeCtx({
        cloudStatus: "in_progress",
        taskRunId: "run-1",
        agentIdleForRunId: "run-1",
      }),
    );
    expect(data.taskRunStatus).toBe("completed");
  });

  it("does not override when the idle marker is for a different run", () => {
    const data = deriveTaskData(
      makeTask(),
      makeCtx({
        cloudStatus: "in_progress",
        taskRunId: "run-2",
        agentIdleForRunId: "run-1",
      }),
    );
    expect(data.taskRunStatus).toBe("in_progress");
  });

  it("leaves an already-terminal status untouched", () => {
    const data = deriveTaskData(
      makeTask({ latest_run: { status: "failed", environment: "cloud" } }),
      makeCtx({
        cloudStatus: "failed",
        taskRunId: "run-1",
        agentIdleForRunId: "run-1",
      }),
    );
    expect(data.taskRunStatus).toBe("failed");
  });
});

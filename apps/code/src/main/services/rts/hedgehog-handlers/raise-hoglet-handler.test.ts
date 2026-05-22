import { describe, expect, it, vi } from "vitest";

vi.mock("../hoglet-runtime-preferences", async () => {
  const schemas =
    await vi.importActual<typeof import("../schemas")>("../schemas");
  return {
    readUserTaskPreferences: vi.fn(() => ({})),
    resolveHogletRuntime: vi.fn(() => ({
      runtimeAdapter: schemas.DEFAULT_HOGLET_RUNTIME_ADAPTER,
      model: schemas.defaultModelForAdapter(
        schemas.DEFAULT_HOGLET_RUNTIME_ADAPTER,
      ),
      reasoningEffort: schemas.defaultReasoningEffortForAdapter(
        schemas.DEFAULT_HOGLET_RUNTIME_ADAPTER,
      ),
      executionMode: "bypassPermissions",
      environment: schemas.DEFAULT_HOGLET_ENVIRONMENT,
    })),
  };
});

import {
  MAX_RAISE_CALLS_PER_TICK,
  raiseHogletHandler,
} from "./raise-hoglet-handler";
import {
  makeContext,
  makeHoglet,
  makeHogletWithState,
  makeMockDeps,
  makeToolBlock,
} from "./test-helpers";

function activeHoglet() {
  return makeHogletWithState({
    hoglet: makeHoglet({ id: "hoglet-a", taskId: "task-a" }),
    taskRunStatus: "completed",
    latestRunId: "run-prev",
  });
}

describe("raiseHogletHandler", () => {
  it("creates and starts a fresh task run on a completed hoglet", async () => {
    const { deps, cloudTasks, hogletService, writeNestMessage } = makeMockDeps();
    cloudTasks.createTaskRun.mockResolvedValue({
      id: "run-new",
      branch: "feature/x",
    });
    cloudTasks.startTaskRun.mockResolvedValue(undefined);

    const result = await raiseHogletHandler.handle(
      makeContext({ hoglets: [activeHoglet()] }),
      makeToolBlock("raise_hoglet", {
        hoglet_id: "hoglet-a",
        prompt: "try again with the fix",
      }),
      deps,
    );

    expect(result.success).toBe(true);
    expect(cloudTasks.createTaskRun).toHaveBeenCalledOnce();
    expect(hogletService.ensureCloudWorkspace).toHaveBeenCalledWith(
      "task-a",
      "feature/x",
    );
    expect(cloudTasks.startTaskRun).toHaveBeenCalledWith("task-a", "run-new", {
      pendingUserMessage: "try again with the fix",
    });
    expect(writeNestMessage).toHaveBeenCalledWith(
      "nest-1",
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          type: "raised_hoglet",
          hogletId: "hoglet-a",
          taskRunId: "run-new",
        }),
      }),
    );
  });

  it("refuses to raise a hoglet whose latest run is in_progress", async () => {
    const { deps, cloudTasks, writeNestMessage } = makeMockDeps();

    const result = await raiseHogletHandler.handle(
      makeContext({
        hoglets: [
          makeHogletWithState({
            hoglet: makeHoglet({ id: "hoglet-busy" }),
            taskRunStatus: "in_progress",
          }),
        ],
      }),
      makeToolBlock("raise_hoglet", { hoglet_id: "hoglet-busy" }),
      deps,
    );

    expect(result.success).toBe(false);
    expect(result.scratchpadSummary).toContain("in_progress");
    expect(cloudTasks.createTaskRun).not.toHaveBeenCalled();
    expect(writeNestMessage).toHaveBeenCalledWith(
      "nest-1",
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          type: "raise_skipped_active",
          hogletId: "hoglet-busy",
        }),
      }),
    );
  });

  it("rolls back the new TaskRun when startTaskRun fails", async () => {
    const { deps, cloudTasks, writeNestMessage } = makeMockDeps();
    cloudTasks.createTaskRun.mockResolvedValue({
      id: "run-orphan",
      branch: null,
    });
    cloudTasks.startTaskRun.mockRejectedValue(new Error("boom"));
    cloudTasks.updateTaskRun.mockResolvedValue(undefined);

    const result = await raiseHogletHandler.handle(
      makeContext({ hoglets: [activeHoglet()] }),
      makeToolBlock("raise_hoglet", { hoglet_id: "hoglet-a" }),
      deps,
    );

    expect(result.success).toBe(false);
    expect(cloudTasks.updateTaskRun).toHaveBeenCalledWith(
      "task-a",
      "run-orphan",
      expect.objectContaining({ status: "cancelled" }),
    );
    expect(writeNestMessage).toHaveBeenCalledWith(
      "nest-1",
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          type: "raise_failed",
          rolledBackTaskRunId: "run-orphan",
        }),
      }),
    );
  });

  it("caps the per-tick raise budget", async () => {
    const ctx = makeContext({ hoglets: [activeHoglet()] });
    ctx.budget.raiseCount = MAX_RAISE_CALLS_PER_TICK;
    const { deps, cloudTasks, writeNestMessage } = makeMockDeps();

    const result = await raiseHogletHandler.handle(
      ctx,
      makeToolBlock("raise_hoglet", { hoglet_id: "hoglet-a" }),
      deps,
    );

    expect(result.success).toBe(false);
    expect(result.scratchpadSummary).toContain("capped");
    expect(cloudTasks.createTaskRun).not.toHaveBeenCalled();
    expect(writeNestMessage).toHaveBeenCalledWith(
      "nest-1",
      expect.objectContaining({
        payloadJson: expect.objectContaining({ type: "raise_capped" }),
      }),
    );
  });

  it("rejects when the hoglet is not in this nest", async () => {
    const { deps, cloudTasks } = makeMockDeps();

    const result = await raiseHogletHandler.handle(
      makeContext({ hoglets: [] }),
      makeToolBlock("raise_hoglet", { hoglet_id: "hoglet-missing" }),
      deps,
    );

    expect(result.success).toBe(false);
    expect(result.scratchpadSummary).toContain("validation failed");
    expect(cloudTasks.createTaskRun).not.toHaveBeenCalled();
  });
});

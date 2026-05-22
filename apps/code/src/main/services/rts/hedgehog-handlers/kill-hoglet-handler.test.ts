import { describe, expect, it } from "vitest";
import { killHogletHandler } from "./kill-hoglet-handler";
import {
  makeContext,
  makeHoglet,
  makeHogletWithState,
  makeMockDeps,
  makeToolBlock,
} from "./test-helpers";

describe("killHogletHandler", () => {
  it("cancels the latest run on a happy-path active hoglet", async () => {
    const ctx = makeContext({
      hoglets: [
        makeHogletWithState({
          hoglet: makeHoglet({ id: "hoglet-a", taskId: "task-a" }),
          taskRunStatus: "in_progress",
          latestRunId: "run-1",
        }),
      ],
    });
    const { deps, cloudTasks, writeNestMessage } = makeMockDeps();
    cloudTasks.updateTaskRun.mockResolvedValue(undefined);

    const result = await killHogletHandler.handle(
      ctx,
      makeToolBlock("kill_hoglet", {
        hoglet_id: "hoglet-a",
        reason: "off-track",
      }),
      deps,
    );

    expect(result.success).toBe(true);
    expect(cloudTasks.updateTaskRun).toHaveBeenCalledWith("task-a", "run-1", {
      status: "cancelled",
    });
    expect(writeNestMessage).toHaveBeenCalledWith(
      "nest-1",
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          type: "killed_hoglet",
          hogletId: "hoglet-a",
        }),
      }),
    );
  });

  it("rejects when the hoglet is not in this nest", async () => {
    const { deps, cloudTasks } = makeMockDeps();

    const result = await killHogletHandler.handle(
      makeContext({ hoglets: [] }),
      makeToolBlock("kill_hoglet", {
        hoglet_id: "ghost",
        reason: "off-track",
      }),
      deps,
    );

    expect(result.success).toBe(false);
    expect(result.scratchpadSummary).toContain("validation failed");
    expect(cloudTasks.updateTaskRun).not.toHaveBeenCalled();
  });

  it("skips kill on an already-inactive hoglet without calling cloudTasks", async () => {
    const { deps, cloudTasks, writeNestMessage } = makeMockDeps();

    const result = await killHogletHandler.handle(
      makeContext({
        hoglets: [
          makeHogletWithState({
            hoglet: makeHoglet({ id: "hoglet-done", taskId: "task-done" }),
            taskRunStatus: "completed",
            latestRunId: "run-prev",
          }),
        ],
      }),
      makeToolBlock("kill_hoglet", {
        hoglet_id: "hoglet-done",
        reason: "double-kill",
      }),
      deps,
    );

    expect(result.success).toBe(false);
    expect(result.scratchpadSummary).toContain("already completed");
    expect(cloudTasks.updateTaskRun).not.toHaveBeenCalled();
    expect(writeNestMessage).toHaveBeenCalledWith(
      "nest-1",
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          type: "kill_skipped_inactive",
        }),
      }),
    );
  });

  it("refuses to kill when no latest_run_id has been resolved", async () => {
    const { deps, cloudTasks, writeNestMessage } = makeMockDeps();

    const result = await killHogletHandler.handle(
      makeContext({
        hoglets: [
          makeHogletWithState({
            hoglet: makeHoglet({ id: "hoglet-nr", taskId: "task-nr" }),
            taskRunStatus: "queued",
            latestRunId: null,
          }),
        ],
      }),
      makeToolBlock("kill_hoglet", {
        hoglet_id: "hoglet-nr",
        reason: "no run id",
      }),
      deps,
    );

    expect(result.success).toBe(false);
    expect(result.scratchpadSummary).toContain("missing latest_run_id");
    expect(cloudTasks.updateTaskRun).not.toHaveBeenCalled();
    expect(writeNestMessage).toHaveBeenCalledWith(
      "nest-1",
      expect.objectContaining({
        payloadJson: expect.objectContaining({ type: "kill_no_run_id" }),
      }),
    );
  });

  it("records kill_failed when updateTaskRun rejects", async () => {
    const { deps, cloudTasks, writeNestMessage } = makeMockDeps();
    cloudTasks.updateTaskRun.mockRejectedValue(new Error("network down"));

    const result = await killHogletHandler.handle(
      makeContext({
        hoglets: [
          makeHogletWithState({
            hoglet: makeHoglet({ id: "hoglet-x", taskId: "task-x" }),
            taskRunStatus: "in_progress",
            latestRunId: "run-x",
          }),
        ],
      }),
      makeToolBlock("kill_hoglet", {
        hoglet_id: "hoglet-x",
        reason: "stuck",
      }),
      deps,
    );

    expect(result.success).toBe(false);
    expect(result.scratchpadSummary).toContain("kill_hoglet errored");
    expect(writeNestMessage).toHaveBeenCalledWith(
      "nest-1",
      expect.objectContaining({
        payloadJson: expect.objectContaining({ type: "kill_failed" }),
      }),
    );
  });
});

import { describe, expect, it } from "vitest";
import { messageHogletHandler } from "./message-hoglet-handler";
import {
  makeContext,
  makeHoglet,
  makeHogletWithState,
  makeMockDeps,
  makeToolBlock,
} from "./test-helpers";

describe("messageHogletHandler", () => {
  it("routes the prompt to feedback-routing and writes an audit row", async () => {
    const hoglet = makeHoglet({ id: "hoglet-a", taskId: "task-a" });
    const ctx = makeContext({
      hoglets: [
        makeHogletWithState({
          hoglet,
          taskRunStatus: "in_progress",
          latestRunId: "run-1",
        }),
      ],
    });
    const { deps, feedbackRouting, writeNestMessage } = makeMockDeps();

    const result = await messageHogletHandler.handle(
      ctx,
      makeToolBlock("message_hoglet", {
        hoglet_id: "hoglet-a",
        prompt: "status please",
      }),
      deps,
    );

    expect(result.success).toBe(true);
    expect(feedbackRouting.routeHedgehogPrompt).toHaveBeenCalledWith({
      taskId: "task-a",
      hogletId: "hoglet-a",
      nestId: "nest-1",
      prompt: "status please",
      toolCallId: "block-1",
      latestRunId: "run-1",
      targetRunStatus: "in_progress",
    });
    expect(writeNestMessage).toHaveBeenCalledWith(
      "nest-1",
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          type: "message_hoglet_injected",
          hogletId: "hoglet-a",
        }),
      }),
    );
  });

  it("rejects when the hoglet is not in this nest", async () => {
    const { deps, feedbackRouting } = makeMockDeps();

    const result = await messageHogletHandler.handle(
      makeContext({ hoglets: [] }),
      makeToolBlock("message_hoglet", {
        hoglet_id: "hoglet-missing",
        prompt: "hi",
      }),
      deps,
    );

    expect(result.success).toBe(false);
    expect(result.scratchpadSummary).toContain("validation failed");
    expect(feedbackRouting.routeHedgehogPrompt).not.toHaveBeenCalled();
  });

  it("passes targetRunStatus=null when the run status is not routable", async () => {
    const hoglet = makeHoglet({ id: "hoglet-b", taskId: "task-b" });
    const ctx = makeContext({
      hoglets: [
        makeHogletWithState({
          hoglet,
          taskRunStatus: "unknown",
          latestRunId: null,
        }),
      ],
    });
    const { deps, feedbackRouting } = makeMockDeps();

    const result = await messageHogletHandler.handle(
      ctx,
      makeToolBlock("message_hoglet", {
        hoglet_id: "hoglet-b",
        prompt: "ping",
      }),
      deps,
    );

    expect(result.success).toBe(true);
    expect(feedbackRouting.routeHedgehogPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        latestRunId: null,
        targetRunStatus: null,
      }),
    );
  });
});

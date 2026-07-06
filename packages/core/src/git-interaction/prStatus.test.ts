import { describe, expect, it } from "vitest";
import {
  deriveMergeQueueState,
  getOptimisticPrState,
  getPrVisualConfig,
  type MergeQueueVisualState,
  PR_ACTION_LABELS,
} from "./prStatus";

describe("deriveMergeQueueState", () => {
  it.each([
    ["queued", null, "queued"],
    ["in_progress", null, "testing"],
    ["completed", "failure", "failed"],
    ["completed", "timed_out", "failed"],
    ["completed", "success", null],
    ["completed", "cancelled", null],
    ["completed", "neutral", null],
    [null, null, null],
    [undefined, undefined, null],
  ] as const)(
    "status=%s conclusion=%s -> %s",
    (status, conclusion, expected) => {
      expect(deriveMergeQueueState(status, conclusion)).toBe(expected);
    },
  );
});

describe("getPrVisualConfig", () => {
  it("merged wins over an active queue state", () => {
    const config = getPrVisualConfig("open", true, false, "testing");
    expect(config.label).toBe("Merged");
    expect(config.color).toBe("purple");
  });

  it("closed wins over an active queue state", () => {
    const config = getPrVisualConfig("closed", false, false, "queued");
    expect(config.label).toBe("Closed");
    expect(config.color).toBe("red");
  });

  it("draft wins over an active queue state", () => {
    const config = getPrVisualConfig("open", false, true, "queued");
    expect(config.label).toBe("Draft");
    expect(config.color).toBe("gray");
  });

  it.each([
    ["queued", "Queued"],
    ["testing", "Testing"],
  ] as const)("shows %s state as orange with a cancel action", (mq, label) => {
    const config = getPrVisualConfig("open", false, false, mq);
    expect(config).toMatchObject({
      color: "orange",
      icon: "queue",
      label,
      actions: [{ id: "merge-queue-cancel", label: "Cancel queue run" }],
    });
  });

  it("shows a failed queue run in red with a retry action", () => {
    const config = getPrVisualConfig("open", false, false, "failed");
    expect(config.color).toBe("red");
    expect(config.label).toBe("Queue failed");
    expect(config.actions.map((a) => a.id)).toEqual(["merge-queue", "close"]);
  });

  it("open PR offers 'Merge via queue' as the first action", () => {
    const config = getPrVisualConfig("open", false, false, null);
    expect(config.label).toBe("Open");
    expect(config.color).toBe("green");
    expect(config.actions[0]).toEqual({
      id: "merge-queue",
      label: "Merge via queue",
    });
  });

  it("defaults mergeQueue to null (plain open badge)", () => {
    expect(getPrVisualConfig("open", false, false).label).toBe("Open");
  });
});

describe("getOptimisticPrState", () => {
  it.each(["merge-queue", "merge-queue-cancel"] as const)(
    "%s keeps the PR open",
    (action) => {
      expect(getOptimisticPrState(action)).toEqual({
        state: "open",
        merged: false,
        draft: false,
      });
    },
  );
});

describe("PR_ACTION_LABELS", () => {
  it("covers the merge-queue actions", () => {
    expect(PR_ACTION_LABELS["merge-queue"]).toBe("PR submitted to merge queue");
    expect(PR_ACTION_LABELS["merge-queue-cancel"]).toBe(
      "Merge queue run cancelled",
    );
  });
});

// Type-only guard so the test file fails to compile if the union drifts.
const _states: MergeQueueVisualState[] = ["queued", "testing", "failed", null];

import { describe, expect, it } from "vitest";
import {
  type CheckRun,
  mapNativeMergeQueueState,
  resolveMergeQueueFromCheckRuns,
} from "./merge-queue-providers";

const run = (partial: Partial<CheckRun> & { name: string }): CheckRun => ({
  status: "queued",
  conclusion: null,
  ...partial,
});

describe("resolveMergeQueueFromCheckRuns", () => {
  it("returns null when there are no check runs", () => {
    expect(resolveMergeQueueFromCheckRuns([])).toBeNull();
  });

  it("returns null when no known provider check is present", () => {
    expect(
      resolveMergeQueueFromCheckRuns([
        run({ name: "build", status: "completed", conclusion: "success" }),
      ]),
    ).toBeNull();
  });

  it.each([
    { provider: "trunk", name: "Trunk Merge Queue (main)" },
    { provider: "mergify", name: "Queue: embarked in merge train" },
    { provider: "mergify", name: "Mergify — automatic merge" },
    { provider: "aviator", name: "aviator/queue" },
    { provider: "kodiak", name: "kodiakhq: status" },
    { provider: "graphite", name: "Graphite / mergeability_check" },
    { provider: "bors", name: "bors" },
  ])("matches the $provider queue check ($name)", ({ name }) => {
    const result = resolveMergeQueueFromCheckRuns([
      run({ name, status: "in_progress" }),
    ]);
    expect(result).toEqual({
      status: "in_progress",
      conclusion: null,
      detailsUrl: null,
      name,
    });
  });

  it("maps a completed+failure run", () => {
    const result = resolveMergeQueueFromCheckRuns([
      run({
        name: "Trunk Merge Queue (main)",
        status: "completed",
        conclusion: "failure",
      }),
    ]);
    expect(result?.status).toBe("completed");
    expect(result?.conclusion).toBe("failure");
  });

  it("picks the most recently started run across re-enqueues", () => {
    const result = resolveMergeQueueFromCheckRuns([
      run({
        name: "Trunk Merge Queue (main)",
        status: "completed",
        conclusion: "failure",
        started_at: "2026-01-01T00:00:00Z",
      }),
      run({
        name: "Trunk Merge Queue (main)",
        status: "queued",
        started_at: "2026-01-02T00:00:00Z",
      }),
    ]);
    expect(result?.status).toBe("queued");
  });

  it("falls back to html_url when details_url is absent", () => {
    const result = resolveMergeQueueFromCheckRuns([
      run({
        name: "Trunk Merge Queue (main)",
        details_url: null,
        html_url: "https://github.com/o/r/runs/1",
      }),
    ]);
    expect(result?.detailsUrl).toBe("https://github.com/o/r/runs/1");
  });

  it("ignores a run whose status is not a queue status", () => {
    expect(
      resolveMergeQueueFromCheckRuns([
        run({ name: "Trunk Merge Queue (main)", status: "waiting" }),
      ]),
    ).toBeNull();
  });
});

describe("mapNativeMergeQueueState", () => {
  it.each([
    ["QUEUED", "queued", null],
    ["AWAITING_CHECKS", "in_progress", null],
    ["LOCKED", "in_progress", null],
    ["MERGEABLE", "in_progress", null],
    ["UNMERGEABLE", "completed", "failure"],
  ] as const)("maps %s -> %s", (state, status, conclusion) => {
    expect(mapNativeMergeQueueState(state)).toEqual({
      status,
      conclusion,
      detailsUrl: null,
      name: "GitHub merge queue",
    });
  });

  it.each([null, undefined, "SOMETHING_NEW"])(
    "returns null for %s",
    (state) => {
      expect(mapNativeMergeQueueState(state)).toBeNull();
    },
  );
});

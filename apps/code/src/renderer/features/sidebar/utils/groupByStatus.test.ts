import { describe, expect, it } from "vitest";
import {
  groupByStatus,
  STATUS_GROUP_IDS,
  type StatusGroupableTask,
} from "./groupByStatus";

interface TestTask extends StatusGroupableTask {
  id: string;
}

function task(id: string, overrides: StatusGroupableTask = {}): TestTask {
  return { id, ...overrides };
}

describe("groupByStatus", () => {
  it("buckets tasks by their status into the expected groups", () => {
    const tasks: TestTask[] = [
      task("idle-1"),
      task("idle-2", { taskRunStatus: "not_started" }),
      task("active-1", { isGenerating: true }),
      task("active-2", { taskRunStatus: "in_progress" }),
      task("active-3", { taskRunStatus: "queued" }),
      task("done-1", { taskRunStatus: "completed" }),
      task("failed-1", { taskRunStatus: "failed" }),
      task("failed-2", { taskRunStatus: "cancelled" }),
      task("needs-1", { needsPermission: true }),
    ];

    const groups = groupByStatus(tasks);
    const byId = new Map(groups.map((g) => [g.id, g] as const));

    expect(byId.get(STATUS_GROUP_IDS.needsYou)?.tasks.map((t) => t.id)).toEqual(
      ["needs-1"],
    );
    expect(byId.get(STATUS_GROUP_IDS.active)?.tasks.map((t) => t.id)).toEqual([
      "active-1",
      "active-2",
      "active-3",
    ]);
    expect(byId.get(STATUS_GROUP_IDS.done)?.tasks.map((t) => t.id)).toEqual([
      "done-1",
    ]);
    expect(byId.get(STATUS_GROUP_IDS.failed)?.tasks.map((t) => t.id)).toEqual([
      "failed-1",
      "failed-2",
    ]);
    expect(byId.get(STATUS_GROUP_IDS.idle)?.tasks.map((t) => t.id)).toEqual([
      "idle-1",
      "idle-2",
    ]);
  });

  it("prefers 'Needs you' over 'Active' when both predicates match", () => {
    const tasks: TestTask[] = [
      task("both", { needsPermission: true, taskRunStatus: "in_progress" }),
    ];

    const groups = groupByStatus(tasks);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe(STATUS_GROUP_IDS.needsYou);
    expect(groups[0].tasks).toHaveLength(1);
  });

  it("returns groups in the fixed display order and omits empty buckets", () => {
    const tasks: TestTask[] = [
      task("c", { taskRunStatus: "completed" }),
      task("f", { taskRunStatus: "failed" }),
      task("a", { taskRunStatus: "in_progress" }),
    ];

    const ids = groupByStatus(tasks).map((g) => g.id);
    expect(ids).toEqual([
      STATUS_GROUP_IDS.active,
      STATUS_GROUP_IDS.done,
      STATUS_GROUP_IDS.failed,
    ]);
  });

  it("returns an empty array when there are no tasks", () => {
    expect(groupByStatus([])).toEqual([]);
  });

  it("preserves the input order of tasks within a bucket", () => {
    const tasks: TestTask[] = [
      task("a", { taskRunStatus: "completed" }),
      task("b", { taskRunStatus: "completed" }),
      task("c", { taskRunStatus: "completed" }),
    ];
    const groups = groupByStatus(tasks);
    expect(groups[0].tasks.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });
});

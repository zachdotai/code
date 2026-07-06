import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";
import type { RootLogger, ScopedLogger } from "@posthog/di/logger";
import { beforeEach, describe, expect, it } from "vitest";
import { EntityRegistry } from "../local-store/entityRegistry";
import { ApplyPipeline } from "../local-store/sync/applyPipeline";
import type { CloudClientProvider } from "../local-store/sync/identifiers";
import {
  setTaskSyncIncludeInternal,
  TASK_SUMMARIES_COLLECTION,
  TASKS_COLLECTION,
  TaskSummariesDeltaSource,
  TasksDeltaSource,
  taskSummariesEntity,
  tasksEntity,
} from "./taskSync";

const noopScoped: ScopedLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
const fakeLogger: RootLogger = { ...noopScoped, scope: () => noopScoped };

interface FakeClientCalls {
  getTasks: Array<Record<string, unknown> | undefined>;
  getTaskSummaries: string[][];
}

function makeClient(overrides?: {
  tasks?: unknown[];
  internalTasks?: unknown[];
  summaries?: unknown[];
}) {
  const calls: FakeClientCalls = { getTasks: [], getTaskSummaries: [] };
  const client = {
    getTasks: async (options?: { internal?: boolean }) => {
      calls.getTasks.push(options);
      return options?.internal
        ? (overrides?.internalTasks ?? [])
        : (overrides?.tasks ?? []);
    },
    getTaskSummaries: async (ids: string[]) => {
      calls.getTaskSummaries.push(ids);
      return overrides?.summaries ?? [];
    },
  } as unknown as PostHogAPIClient;
  return { client, calls };
}

function provider(client: PostHogAPIClient | null): CloudClientProvider {
  return { getClient: () => client };
}

describe("TasksDeltaSource", () => {
  beforeEach(() => setTaskSyncIncludeInternal(false));

  it("skips the tick when no client is available", async () => {
    const source = new TasksDeltaSource(provider(null));
    expect(await source.pull()).toBeNull();
  });

  it("pulls the base window only by default", async () => {
    const { client, calls } = makeClient({
      tasks: [{ id: "t1", internal: false }],
    });
    const source = new TasksDeltaSource(provider(client));

    const windows = await source.pull();

    expect(calls.getTasks).toEqual([{}]);
    expect(windows).toHaveLength(1);
    expect(windows?.[0]?.key).toBe("base");
    expect(windows?.[0]?.sweep?.complete).toBe(true);
    // Base window must never sweep internal rows.
    expect(
      windows?.[0]?.sweep?.matches({ id: "x", internal: true } as never),
    ).toBe(false);
    expect(
      windows?.[0]?.sweep?.matches({ id: "x", internal: false } as never),
    ).toBe(true);
  });

  it("adds the internal window when the toggle is on, scoped to internal rows", async () => {
    setTaskSyncIncludeInternal(true);
    const { client, calls } = makeClient({
      tasks: [{ id: "t1" }],
      internalTasks: [{ id: "i1", internal: true }],
    });
    const source = new TasksDeltaSource(provider(client));

    const windows = await source.pull();

    expect(calls.getTasks).toEqual([{}, { internal: true }]);
    expect(windows?.map((w) => w.key)).toEqual(["base", "internal"]);
    expect(
      windows?.[1]?.sweep?.matches({ id: "x", internal: true } as never),
    ).toBe(true);
    expect(
      windows?.[1]?.sweep?.matches({ id: "x", internal: false } as never),
    ).toBe(false);
  });

  it("marks the window incomplete when the page limit is hit", async () => {
    const tasks = Array.from({ length: 500 }, (_, i) => ({ id: `t${i}` }));
    const { client } = makeClient({ tasks });
    const source = new TasksDeltaSource(provider(client));

    const windows = await source.pull();
    expect(windows?.[0]?.sweep?.complete).toBe(false);
  });
});

describe("TaskSummariesDeltaSource", () => {
  function makeRig() {
    const registry = new EntityRegistry();
    const tasksPool = registry.register(tasksEntity);
    const summariesPool = registry.register(taskSummariesEntity);
    const pipeline = new ApplyPipeline(registry, fakeLogger);
    return { registry, tasksPool, summariesPool, pipeline };
  }

  it("requests summaries for exactly the local task ids", async () => {
    const { registry, tasksPool } = makeRig();
    tasksPool.applyUpserts([{ id: "t1" }, { id: "t2" }]);
    const { client, calls } = makeClient({
      summaries: [{ id: "t1" }, { id: "t2" }],
    });

    const source = new TaskSummariesDeltaSource(provider(client), registry);
    const windows = await source.pull();

    expect(calls.getTaskSummaries).toEqual([["t1", "t2"]]);
    expect(windows?.[0]?.rows).toHaveLength(2);
  });

  it("sweeps summaries whose tasks are gone (cascade)", async () => {
    const { registry, tasksPool, summariesPool, pipeline } = makeRig();
    tasksPool.applyUpserts([{ id: "t1" }]);
    summariesPool.applyUpserts([{ id: "t1" }, { id: "stale-task" }]);

    const { client } = makeClient({ summaries: [{ id: "t1" }] });
    const source = new TaskSummariesDeltaSource(provider(client), registry);
    const windows = await source.pull();
    const delta = pipeline.applyWindows(
      TASK_SUMMARIES_COLLECTION,
      windows ?? [],
    );

    expect(delta.deletes).toEqual(["stale-task"]);
    expect(summariesPool.get("t1")).toBeDefined();
    expect(summariesPool.get("stale-task")).toBeUndefined();
  });

  it("returns an all-sweeping empty window when there are no tasks", async () => {
    const { registry, summariesPool, pipeline } = makeRig();
    summariesPool.applyUpserts([{ id: "orphan" }]);
    const { client, calls } = makeClient();

    const source = new TaskSummariesDeltaSource(provider(client), registry);
    const windows = await source.pull();

    expect(calls.getTaskSummaries).toEqual([]);
    const delta = pipeline.applyWindows(
      TASK_SUMMARIES_COLLECTION,
      windows ?? [],
    );
    expect(delta.deletes).toEqual(["orphan"]);
  });
});

describe("tasks collection registration", () => {
  it("registers both collections under stable names", () => {
    const registry = new EntityRegistry();
    registry.register(tasksEntity);
    registry.register(taskSummariesEntity);
    expect(registry.getDefinition(TASKS_COLLECTION)?.version).toBe(1);
    expect(registry.getDefinition(TASK_SUMMARIES_COLLECTION)?.version).toBe(1);
  });
});

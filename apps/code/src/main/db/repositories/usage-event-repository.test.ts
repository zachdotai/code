import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDatabase } from "../test-helpers";
import { HogletRepository } from "./hoglet-repository";
import { NestRepository } from "./nest-repository";
import { UsageEventRepository } from "./usage-event-repository";

function makeRepos(testDb: TestDatabase): {
  usage: UsageEventRepository;
  hoglets: HogletRepository;
  nests: NestRepository;
} {
  const dbService = { db: testDb.db } as never;
  return {
    usage: new UsageEventRepository(dbService),
    hoglets: new HogletRepository(dbService),
    nests: new NestRepository(dbService),
  };
}

describe("UsageEventRepository", () => {
  let testDb: TestDatabase;
  let usage: UsageEventRepository;
  let hoglets: HogletRepository;
  let nests: NestRepository;

  beforeEach(() => {
    testDb = createTestDb();
    ({ usage, hoglets, nests } = makeRepos(testDb));
  });

  afterEach(() => testDb.close());

  function insertNest(name = "n1") {
    return nests.create({
      name,
      goalPrompt: "do thing",
      mapX: 0,
      mapY: 0,
    });
  }

  function insertHoglet(nestId: string | null, taskId: string) {
    return hoglets.create({
      taskId,
      nestId,
      name: "h1",
    });
  }

  it("inserts a usage event with all FinOps tag columns set", () => {
    const nest = insertNest();
    const hoglet = insertHoglet(nest.id, "task-1");
    const { inserted, row } = usage.insertIgnoreOnDuplicate({
      nestId: nest.id,
      hogletId: hoglet.id,
      taskId: "task-1",
      taskRunId: "run-1",
      turnIndex: 0,
      environment: "dev",
      workload: "brood-hoglet",
      model: "claude-opus-4-7",
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      cacheCreationTokens: 5,
      costUsd: 0.42,
      costSource: "sdk",
    });

    expect(inserted).toBe(true);
    expect(row.workload).toBe("brood-hoglet");
    expect(row.team).toBe("posthog-code");
    expect(row.product).toBe("hedgemony");
    expect(row.system).toBe("hedgemony");
    expect(row.costUsd).toBe(0.42);
    expect(row.costSource).toBe("sdk");
  });

  it("dedupes on (taskRunId, turnIndex)", () => {
    const nest = insertNest();
    const hoglet = insertHoglet(nest.id, "task-1");
    const args = {
      nestId: nest.id,
      hogletId: hoglet.id,
      taskId: "task-1",
      taskRunId: "run-1",
      turnIndex: 0,
      environment: "dev",
      workload: "brood-hoglet" as const,
      model: "claude-opus-4-7",
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0.42,
      costSource: "sdk" as const,
    };

    const first = usage.insertIgnoreOnDuplicate(args);
    const second = usage.insertIgnoreOnDuplicate({ ...args, costUsd: 999 });

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    // Existing row returned, not the new one
    expect(second.row.costUsd).toBe(0.42);
  });

  it("allows multiple inserts when taskRunId+turnIndex are both null (hedgehog ticks)", () => {
    const nest = insertNest();
    const base = {
      nestId: nest.id,
      hogletId: null,
      taskId: null,
      taskRunId: null,
      turnIndex: null,
      environment: "dev",
      workload: "hedgehog-tick" as const,
      model: "claude-opus-4-7",
      inputTokens: 10,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0.1,
      costSource: "pricing_table" as const,
    };
    const a = usage.insertIgnoreOnDuplicate(base);
    const b = usage.insertIgnoreOnDuplicate(base);
    expect(a.inserted).toBe(true);
    expect(b.inserted).toBe(true);
    expect(a.row.id).not.toBe(b.row.id);
  });

  it("aggregates by nest across multiple events", () => {
    const nest = insertNest();
    const hoglet = insertHoglet(nest.id, "task-1");
    for (let i = 0; i < 3; i++) {
      usage.insertIgnoreOnDuplicate({
        nestId: nest.id,
        hogletId: hoglet.id,
        taskId: "task-1",
        taskRunId: "run-1",
        turnIndex: i,
        environment: "dev",
        workload: "brood-hoglet",
        model: "claude-opus-4-7",
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 10,
        cacheCreationTokens: 5,
        costUsd: 0.5,
        costSource: "sdk",
      });
    }
    const agg = usage.aggregateByNest(nest.id);
    expect(agg.eventCount).toBe(3);
    expect(agg.totalInputTokens).toBe(300);
    expect(agg.totalOutputTokens).toBe(150);
    expect(agg.totalCacheReadTokens).toBe(30);
    expect(agg.totalCacheCreationTokens).toBe(15);
    expect(agg.totalCostUsd).toBeCloseTo(1.5, 6);
  });

  it("aggregates by hoglet correctly", () => {
    const nest = insertNest();
    const h1 = insertHoglet(nest.id, "task-1");
    const h2 = insertHoglet(nest.id, "task-2");
    usage.insertIgnoreOnDuplicate({
      nestId: nest.id,
      hogletId: h1.id,
      taskId: "task-1",
      taskRunId: "run-a",
      turnIndex: 0,
      environment: "dev",
      workload: "brood-hoglet",
      model: "claude-opus-4-7",
      inputTokens: 10,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 1.0,
      costSource: "sdk",
    });
    usage.insertIgnoreOnDuplicate({
      nestId: nest.id,
      hogletId: h2.id,
      taskId: "task-2",
      taskRunId: "run-b",
      turnIndex: 0,
      environment: "dev",
      workload: "brood-hoglet",
      model: "claude-opus-4-7",
      inputTokens: 20,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 2.0,
      costSource: "sdk",
    });
    expect(usage.aggregateByHoglet(h1.id).totalCostUsd).toBeCloseTo(1.0, 6);
    expect(usage.aggregateByHoglet(h2.id).totalCostUsd).toBeCloseTo(2.0, 6);
  });
});

describe("HogletRepository.incrementUsage", () => {
  let testDb: TestDatabase;
  let hoglets: HogletRepository;
  let nests: NestRepository;

  beforeEach(() => {
    testDb = createTestDb();
    ({ hoglets, nests } = makeRepos(testDb));
  });

  afterEach(() => testDb.close());

  it("accumulates rolling totals atomically", () => {
    const nest = nests.create({
      name: "n",
      goalPrompt: "g",
      mapX: 0,
      mapY: 0,
    });
    const hoglet = hoglets.create({
      taskId: "task-1",
      nestId: nest.id,
      model: "claude-opus-4-7",
    });

    hoglets.incrementUsage(hoglet.id, {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      cacheCreationTokens: 5,
      costUsd: 0.42,
      occurredAt: "2026-05-14T00:00:00Z",
    });
    hoglets.incrementUsage(hoglet.id, {
      inputTokens: 50,
      outputTokens: 25,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0.21,
      occurredAt: "2026-05-14T00:01:00Z",
    });

    const updated = hoglets.findById(hoglet.id);
    expect(updated?.totalInputTokens).toBe(150);
    expect(updated?.totalOutputTokens).toBe(75);
    expect(updated?.totalCacheReadTokens).toBe(10);
    expect(updated?.totalCacheCreationTokens).toBe(5);
    expect(updated?.totalCostUsd).toBeCloseTo(0.63, 6);
    expect(updated?.lastUsageAt).toBe("2026-05-14T00:01:00Z");
  });
});

describe("NestRepository.incrementUsage", () => {
  let testDb: TestDatabase;
  let nests: NestRepository;

  beforeEach(() => {
    testDb = createTestDb();
    ({ nests } = makeRepos(testDb));
  });

  afterEach(() => testDb.close());

  it("accumulates rolling totals on the nest row", () => {
    const nest = nests.create({
      name: "n",
      goalPrompt: "g",
      mapX: 0,
      mapY: 0,
    });

    nests.incrementUsage(nest.id, {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 1.0,
      occurredAt: "2026-05-14T00:00:00Z",
    });

    const updated = nests.findById(nest.id);
    expect(updated?.totalInputTokens).toBe(100);
    expect(updated?.totalOutputTokens).toBe(50);
    expect(updated?.totalCostUsd).toBeCloseTo(1.0, 6);
  });
});

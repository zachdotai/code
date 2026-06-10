import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDatabase } from "../../test-helpers";
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
    expect(row.product).toBe("rts");
    expect(row.system).toBe("rts");
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

  it("aggregateGlobal returns zeros on empty db", () => {
    const agg = usage.aggregateGlobal();
    expect(agg.eventCount).toBe(0);
    expect(agg.totalCostUsd).toBe(0);
    expect(agg.totalInputTokens).toBe(0);
  });

  it("aggregateGlobal sums across nests, hoglets, and hedgehog ticks", () => {
    const n1 = insertNest("n1");
    const n2 = insertNest("n2");
    const h1 = insertHoglet(n1.id, "task-1");

    // brood hoglet turn
    usage.insertIgnoreOnDuplicate({
      nestId: n1.id,
      hogletId: h1.id,
      taskId: "task-1",
      taskRunId: "run-a",
      turnIndex: 0,
      environment: "dev",
      workload: "brood-hoglet",
      model: "claude-opus-4-7",
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 1.0,
      costSource: "sdk",
    });
    // wild hoglet, no nest
    usage.insertIgnoreOnDuplicate({
      nestId: null,
      hogletId: null,
      taskId: "task-wild",
      taskRunId: "run-wild",
      turnIndex: 0,
      environment: "dev",
      workload: "wild-hoglet",
      model: "claude-sonnet-4-6",
      inputTokens: 20,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0.25,
      costSource: "sdk",
    });
    // hedgehog tick on n2
    usage.insertIgnoreOnDuplicate({
      nestId: n2.id,
      hogletId: null,
      taskId: null,
      taskRunId: null,
      turnIndex: null,
      environment: "dev",
      workload: "hedgehog-tick",
      model: "claude-opus-4-7",
      inputTokens: 5,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0.1,
      costSource: "pricing_table",
    });

    const agg = usage.aggregateGlobal();
    expect(agg.eventCount).toBe(3);
    expect(agg.totalCostUsd).toBeCloseTo(1.35, 6);
    expect(agg.totalInputTokens).toBe(125);
    expect(agg.totalOutputTokens).toBe(65);
  });

  it("aggregateByWorkload groups across the three workload kinds", () => {
    const n1 = insertNest("n1");
    const h1 = insertHoglet(n1.id, "task-1");

    usage.insertIgnoreOnDuplicate({
      nestId: n1.id,
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
      nestId: null,
      hogletId: null,
      taskId: "task-2",
      taskRunId: "run-b",
      turnIndex: 0,
      environment: "dev",
      workload: "wild-hoglet",
      model: "claude-opus-4-7",
      inputTokens: 10,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 2.0,
      costSource: "sdk",
    });
    usage.insertIgnoreOnDuplicate({
      nestId: n1.id,
      hogletId: null,
      taskId: null,
      taskRunId: null,
      turnIndex: null,
      environment: "dev",
      workload: "hedgehog-tick",
      model: "claude-opus-4-7",
      inputTokens: 10,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0.5,
      costSource: "pricing_table",
    });

    const rows = usage.aggregateByWorkload();
    expect(rows).toHaveLength(3);
    const byKind = new Map(rows.map((r) => [r.workload, r.row]));
    expect(byKind.get("brood-hoglet")?.totalCostUsd).toBeCloseTo(1.0, 6);
    expect(byKind.get("wild-hoglet")?.totalCostUsd).toBeCloseTo(2.0, 6);
    expect(byKind.get("hedgehog-tick")?.totalCostUsd).toBeCloseTo(0.5, 6);
  });

  it("aggregateByModel groups and orders by cost desc", () => {
    const n1 = insertNest("n1");
    const h1 = insertHoglet(n1.id, "task-1");

    usage.insertIgnoreOnDuplicate({
      nestId: n1.id,
      hogletId: h1.id,
      taskId: "task-1",
      taskRunId: "run-a",
      turnIndex: 0,
      environment: "dev",
      workload: "brood-hoglet",
      model: "claude-sonnet-4-6",
      inputTokens: 10,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0.3,
      costSource: "sdk",
    });
    usage.insertIgnoreOnDuplicate({
      nestId: n1.id,
      hogletId: h1.id,
      taskId: "task-1",
      taskRunId: "run-a",
      turnIndex: 1,
      environment: "dev",
      workload: "brood-hoglet",
      model: "claude-opus-4-7",
      inputTokens: 10,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 1.5,
      costSource: "sdk",
    });

    const rows = usage.aggregateByModel();
    expect(rows).toHaveLength(2);
    // ordered by cost desc → opus first
    expect(rows[0].model).toBe("claude-opus-4-7");
    expect(rows[0].row.totalCostUsd).toBeCloseTo(1.5, 6);
    expect(rows[1].model).toBe("claude-sonnet-4-6");
    expect(rows[1].row.totalCostUsd).toBeCloseTo(0.3, 6);
  });

  it("topNestsByCost ranks nests, excludes null-nest events, and honors limit", () => {
    const n1 = insertNest("cheap");
    const n2 = insertNest("expensive");
    const n3 = insertNest("middle");
    const h1 = insertHoglet(n1.id, "t1");
    const h2 = insertHoglet(n2.id, "t2");
    const h3 = insertHoglet(n3.id, "t3");

    const seed = (
      nestId: string,
      hogletId: string,
      taskRunId: string,
      cost: number,
    ) =>
      usage.insertIgnoreOnDuplicate({
        nestId,
        hogletId,
        taskId: taskRunId,
        taskRunId,
        turnIndex: 0,
        environment: "dev",
        workload: "brood-hoglet",
        model: "claude-opus-4-7",
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: cost,
        costSource: "sdk",
      });

    seed(n1.id, h1.id, "r-cheap", 0.1);
    seed(n2.id, h2.id, "r-expensive", 9.99);
    seed(n3.id, h3.id, "r-middle", 1.0);
    // Wild hoglet event (null nestId) must be excluded from the ranking.
    usage.insertIgnoreOnDuplicate({
      nestId: null,
      hogletId: null,
      taskId: "task-wild",
      taskRunId: "run-wild",
      turnIndex: 0,
      environment: "dev",
      workload: "wild-hoglet",
      model: "claude-opus-4-7",
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 50,
      costSource: "sdk",
    });

    const top = usage.topNestsByCost(2);
    expect(top).toHaveLength(2);
    expect(top[0].nestId).toBe(n2.id);
    expect(top[0].row.totalCostUsd).toBeCloseTo(9.99, 6);
    expect(top[1].nestId).toBe(n3.id);
    expect(top[1].row.totalCostUsd).toBeCloseTo(1.0, 6);
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

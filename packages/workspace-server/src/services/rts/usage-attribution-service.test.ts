import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./logger", () => ({
  logger: {
    scope: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

import type { HogletRepository } from "../../db/repositories/rts/hoglet-repository";
import type { NestRepository } from "../../db/repositories/rts/nest-repository";
import type { UsageEventRepository } from "../../db/repositories/rts/usage-event-repository";
import type { AgentService } from "../agent/agent";
import { AgentServiceEvent } from "../agent/schemas";
import type { RtsAuth } from "./ports";
import { UsageAttributionService } from "./usage-attribution-service";

interface MockListeners {
  [key: string]: ((payload: unknown) => void)[];
}

function createMockAgentService(): {
  service: AgentService;
  emit: (event: string, payload: unknown) => void;
} {
  const listeners: MockListeners = {};
  const service = {
    on: vi.fn((event: string, handler: (payload: unknown) => void) => {
      if (!listeners[event]) {
        listeners[event] = [];
      }
      listeners[event].push(handler);
    }),
  } as unknown as AgentService;
  return {
    service,
    emit: (event, payload) => {
      for (const handler of listeners[event] ?? []) handler(payload);
    },
  };
}

function createMockAuthService(region: "us" | "eu" | "dev" | null): RtsAuth {
  return {
    getState: vi.fn(() => ({ cloudRegion: region })),
  } as unknown as RtsAuth;
}

function createMockUsageEventRepo() {
  const inserts: unknown[] = [];
  let nextInserted = true;
  return {
    inserts,
    setInsertedResult: (value: boolean) => {
      nextInserted = value;
    },
    repo: {
      insertIgnoreOnDuplicate: vi.fn((data) => {
        inserts.push(data);
        return {
          inserted: nextInserted,
          row: { ...data, id: "evt-1", occurredAt: "ts" },
        };
      }),
    } as unknown as UsageEventRepository,
  };
}

function createMockHogletRepo(byTaskId: Record<string, unknown>) {
  const increments: { id: string; data: unknown }[] = [];
  return {
    increments,
    repo: {
      findByTaskId: vi.fn((taskId: string) => byTaskId[taskId] ?? null),
      incrementUsage: vi.fn((id: string, data: unknown) => {
        increments.push({ id, data });
      }),
    } as unknown as HogletRepository,
  };
}

function createMockNestRepo() {
  const increments: { id: string; data: unknown }[] = [];
  return {
    increments,
    repo: {
      incrementUsage: vi.fn((id: string, data: unknown) => {
        increments.push({ id, data });
      }),
    } as unknown as NestRepository,
  };
}

describe("UsageAttributionService.recordHogletTurn", () => {
  let usageEvents: ReturnType<typeof createMockUsageEventRepo>;
  let hoglets: ReturnType<typeof createMockHogletRepo>;
  let nests: ReturnType<typeof createMockNestRepo>;
  let agent: ReturnType<typeof createMockAgentService>;
  let service: UsageAttributionService;

  beforeEach(() => {
    usageEvents = createMockUsageEventRepo();
    hoglets = createMockHogletRepo({
      "task-brood": {
        id: "hoglet-1",
        nestId: "nest-1",
      },
      "task-wild": {
        id: "hoglet-2",
        nestId: null,
      },
    });
    nests = createMockNestRepo();
    agent = createMockAgentService();
    service = new UsageAttributionService(
      usageEvents.repo,
      hoglets.repo,
      nests.repo,
      createMockAuthService("us"),
      agent.service,
    );
    service.init();
  });

  it("records a brood hoglet turn with SDK cost, increments both rollups", () => {
    const result = service.recordHogletTurn({
      taskId: "task-brood",
      taskRunId: "run-1",
      turnIndex: 0,
      model: "claude-opus-4-7",
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      cacheCreationTokens: 5,
      sdkCostUsd: 0.42,
    });

    expect(result?.inserted).toBe(true);
    expect(result?.costUsd).toBe(0.42);
    expect(result?.costSource).toBe("sdk");

    expect(usageEvents.inserts).toHaveLength(1);
    expect(usageEvents.inserts[0]).toMatchObject({
      hogletId: "hoglet-1",
      nestId: "nest-1",
      workload: "brood-hoglet",
      environment: "prod-us",
      costUsd: 0.42,
      costSource: "sdk",
    });

    expect(hoglets.increments).toHaveLength(1);
    expect(hoglets.increments[0]).toMatchObject({
      id: "hoglet-1",
      data: { costUsd: 0.42, inputTokens: 100 },
    });
    expect(nests.increments).toHaveLength(1);
    expect(nests.increments[0].id).toBe("nest-1");
  });

  it("classifies wild hoglet correctly and skips nest rollup", () => {
    service.recordHogletTurn({
      taskId: "task-wild",
      taskRunId: "run-2",
      turnIndex: 0,
      model: "claude-sonnet-4-6",
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      sdkCostUsd: 0.1,
    });

    expect(usageEvents.inserts[0]).toMatchObject({
      hogletId: "hoglet-2",
      nestId: null,
      workload: "wild-hoglet",
    });
    expect(hoglets.increments).toHaveLength(1);
    expect(nests.increments).toHaveLength(0);
  });

  it("falls back to pricing-table cost when SDK cost is missing", () => {
    const result = service.recordHogletTurn({
      taskId: "task-brood",
      taskRunId: "run-3",
      turnIndex: 0,
      model: "claude-haiku-4-5",
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      sdkCostUsd: null,
    });

    expect(result?.costSource).toBe("pricing_table");
    expect(result?.costUsd).toBeCloseTo(1.0, 6);
  });

  it("skips rollup updates on dedupe collision", () => {
    usageEvents.setInsertedResult(false);
    service.recordHogletTurn({
      taskId: "task-brood",
      taskRunId: "run-4",
      turnIndex: 0,
      model: "claude-opus-4-7",
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      sdkCostUsd: 0.5,
    });
    expect(hoglets.increments).toHaveLength(0);
    expect(nests.increments).toHaveLength(0);
  });

  it("returns null and skips persistence when no hoglet matches taskId", () => {
    const result = service.recordHogletTurn({
      taskId: "unknown-task",
      taskRunId: "run-5",
      turnIndex: 0,
      model: "claude-opus-4-7",
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      sdkCostUsd: 0.01,
    });
    expect(result).toBeNull();
    expect(usageEvents.inserts).toHaveLength(0);
  });

  it("subscribes to AgentService.UsageUpdate via init()", () => {
    agent.emit(AgentServiceEvent.UsageUpdate, {
      taskRunId: "run-6",
      taskId: "task-brood",
      turnIndex: 7,
      model: "claude-opus-4-7",
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0.05,
    });
    expect(usageEvents.inserts).toHaveLength(1);
    expect(usageEvents.inserts[0]).toMatchObject({
      taskRunId: "run-6",
      turnIndex: 7,
      hogletId: "hoglet-1",
    });
  });
});

describe("UsageAttributionService.recordHedgehogTick", () => {
  it("uses pricing_table cost and skips hoglet rollup", () => {
    const usageEvents = createMockUsageEventRepo();
    const hoglets = createMockHogletRepo({});
    const nests = createMockNestRepo();
    const agent = createMockAgentService();
    const service = new UsageAttributionService(
      usageEvents.repo,
      hoglets.repo,
      nests.repo,
      createMockAuthService("eu"),
      agent.service,
    );

    const result = service.recordHedgehogTick({
      nestId: "nest-1",
      model: "claude-opus-4-7",
      inputTokens: 1_000_000,
      outputTokens: 0,
    });

    expect(result.costSource).toBe("pricing_table");
    expect(result.costUsd).toBeCloseTo(15.0, 6);
    expect(usageEvents.inserts[0]).toMatchObject({
      nestId: "nest-1",
      hogletId: null,
      workload: "hedgehog-tick",
      environment: "prod-eu",
    });
    expect(nests.increments).toHaveLength(1);
    expect(hoglets.increments).toHaveLength(0);
  });

  it("defaults environment to dev for null region", () => {
    const usageEvents = createMockUsageEventRepo();
    const service = new UsageAttributionService(
      usageEvents.repo,
      createMockHogletRepo({}).repo,
      createMockNestRepo().repo,
      createMockAuthService(null),
      createMockAgentService().service,
    );
    service.recordHedgehogTick({
      nestId: "nest-1",
      model: "claude-opus-4-7",
      inputTokens: 10,
      outputTokens: 10,
    });
    expect(usageEvents.inserts[0]).toMatchObject({ environment: "dev" });
  });
});

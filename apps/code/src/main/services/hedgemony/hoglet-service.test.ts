import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    scope: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

import type { HogletRepository } from "../../db/repositories/hoglet-repository";
import { HogletService, MAX_WILD_HOGLETS } from "./hoglet-service";
import { HedgemonyEvent, type Hoglet } from "./schemas";

type CreateHogletData = Parameters<HogletRepository["create"]>[0];

function makeHoglet(overrides: Partial<Hoglet> = {}): Hoglet {
  const now = "2026-05-13T00:00:00.000Z";
  return {
    id: crypto.randomUUID(),
    taskId: `task-${crypto.randomUUID().slice(0, 8)}`,
    nestId: null,
    signalReportId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

function createMockRepo() {
  const hoglets = new Map<string, Hoglet>();
  const repo = {
    _hoglets: hoglets,
    findById: vi.fn((id: string) => hoglets.get(id) ?? null),
    findByTaskId: vi.fn((taskId: string) => {
      for (const h of hoglets.values()) {
        if (h.taskId === taskId && !h.deletedAt) return h;
      }
      return null;
    }),
    findAllWild: vi.fn(() =>
      [...hoglets.values()].filter(
        (h) => h.nestId === null && h.signalReportId === null && !h.deletedAt,
      ),
    ),
    findAllForNest: vi.fn((nestId: string) =>
      [...hoglets.values()].filter((h) => h.nestId === nestId && !h.deletedAt),
    ),
    countWild: vi.fn(
      () =>
        [...hoglets.values()].filter(
          (h) => h.nestId === null && h.signalReportId === null && !h.deletedAt,
        ).length,
    ),
    create: vi.fn((data: CreateHogletData) => {
      const hoglet = makeHoglet({
        taskId: data.taskId,
        nestId: data.nestId ?? null,
        signalReportId: data.signalReportId ?? null,
      });
      hoglets.set(hoglet.id, hoglet);
      return hoglet;
    }),
    update: vi.fn(),
    softDelete: vi.fn(),
  };
  return repo as typeof repo & HogletRepository;
}

describe("HogletService", () => {
  let repo: ReturnType<typeof createMockRepo>;
  let service: HogletService;

  beforeEach(() => {
    repo = createMockRepo();
    service = new HogletService(repo);
  });

  it("records an adhoc hoglet and emits a wild change event", () => {
    const listener = vi.fn();
    service.on(HedgemonyEvent.HogletChanged, listener);

    const hoglet = service.recordAdhoc({ taskId: "task-1" });

    expect(repo.create).toHaveBeenCalledWith({
      taskId: "task-1",
      nestId: null,
      signalReportId: null,
    });
    expect(hoglet).toMatchObject({
      taskId: "task-1",
      nestId: null,
      signalReportId: null,
    });
    expect(listener).toHaveBeenCalledWith({
      nestId: null,
      event: { kind: "upsert", hoglet },
    });
  });

  it("is idempotent for the same taskId", () => {
    const first = service.recordAdhoc({ taskId: "task-1" });
    const second = service.recordAdhoc({ taskId: "task-1" });

    expect(second.id).toBe(first.id);
    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  it("enforces the wild hoglet cap", () => {
    for (let i = 0; i < MAX_WILD_HOGLETS; i++) {
      service.recordAdhoc({ taskId: `task-${i}` });
    }

    expect(() => service.recordAdhoc({ taskId: "task-overflow" })).toThrowError(
      "wild_hoglet_cap_reached",
    );
  });

  it("filters list output by scope", () => {
    service.recordAdhoc({ taskId: "task-1" });
    service.recordAdhoc({ taskId: "task-2" });

    expect(service.list({ wildOnly: true })).toHaveLength(2);

    repo._hoglets.set(
      "nested",
      makeHoglet({ id: "nested", taskId: "task-3", nestId: "nest-A" }),
    );
    expect(service.list({ nestId: "nest-A" })).toHaveLength(1);
    expect(service.list({ wildOnly: true })).toHaveLength(2);
  });

  it("rejects list calls without scope", () => {
    expect(() => service.list({})).toThrowError(
      "hoglets.list requires wildOnly or nestId",
    );
  });
});

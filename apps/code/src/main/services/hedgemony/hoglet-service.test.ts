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
import type { PrDependencyRepository } from "../../db/repositories/pr-dependency-repository";
import { createMockPrDependencyRepository } from "../../db/repositories/pr-dependency-repository.mock";
import type { AffinityRouterService } from "./affinity-router";
import type { CloudTaskClient } from "./cloud-task-client";
import {
  HogletService,
  MAX_SIGNAL_STAGING_HOGLETS,
  MAX_WILD_HOGLETS,
} from "./hoglet-service";
import { HedgemonyEvent, type Hoglet } from "./schemas";

type CreateHogletData = Parameters<HogletRepository["create"]>[0];
type UpdateHogletData = Parameters<HogletRepository["update"]>[1];

function makeHoglet(overrides: Partial<Hoglet> = {}): Hoglet {
  const now = "2026-05-13T00:00:00.000Z";
  return {
    id: crypto.randomUUID(),
    name: null,
    taskId: `task-${crypto.randomUUID().slice(0, 8)}`,
    nestId: null,
    signalReportId: null,
    affinityScore: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

function createMockAffinityRouter(
  routeReturn:
    | { nestId: string; score: number }
    | null
    | ((input: {
        signalReportId: string;
      }) => Promise<{ nestId: string; score: number } | null>) = null,
): AffinityRouterService {
  const route =
    typeof routeReturn === "function"
      ? vi.fn(routeReturn)
      : vi.fn(async () => routeReturn);
  return { route } as unknown as AffinityRouterService;
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
    findBySignalReportId: vi.fn((signalReportId: string) => {
      for (const h of hoglets.values()) {
        if (h.signalReportId === signalReportId && !h.deletedAt) return h;
      }
      return null;
    }),
    findAllWild: vi.fn(() =>
      [...hoglets.values()].filter(
        (h) => h.nestId === null && h.signalReportId === null && !h.deletedAt,
      ),
    ),
    findAllSignalStaging: vi.fn(() =>
      [...hoglets.values()].filter(
        (h) => h.nestId === null && h.signalReportId !== null && !h.deletedAt,
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
    countSignalStaging: vi.fn(
      () =>
        [...hoglets.values()].filter(
          (h) => h.nestId === null && h.signalReportId !== null && !h.deletedAt,
        ).length,
    ),
    create: vi.fn((data: CreateHogletData) => {
      const hoglet = makeHoglet({
        taskId: data.taskId,
        nestId: data.nestId ?? null,
        signalReportId: data.signalReportId ?? null,
        affinityScore: data.affinityScore ?? null,
      });
      hoglets.set(hoglet.id, hoglet);
      return hoglet;
    }),
    update: vi.fn((id: string, patch: UpdateHogletData) => {
      const existing = hoglets.get(id);
      if (!existing) return null;
      const updated = {
        ...existing,
        ...(patch.nestId !== undefined ? { nestId: patch.nestId } : {}),
        ...(patch.signalReportId !== undefined
          ? { signalReportId: patch.signalReportId }
          : {}),
        ...(patch.affinityScore !== undefined
          ? { affinityScore: patch.affinityScore }
          : {}),
        updatedAt: new Date().toISOString(),
      };
      hoglets.set(id, updated);
      return updated;
    }),
    findAllNames: vi.fn(() =>
      [...hoglets.values()]
        .filter((h) => h.name && !h.deletedAt)
        .map((h) => h.name!),
    ),
    softDelete: vi.fn((id: string) => {
      const existing = hoglets.get(id);
      if (!existing) return null;
      const updated = {
        ...existing,
        deletedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      hoglets.set(id, updated);
      return updated;
    }),
  };
  return repo as typeof repo & HogletRepository;
}

function createMockCloudTaskClient(
  taskOverrides: Partial<{
    id: string;
    title: string;
    repository: string | null;
  }> = {},
): CloudTaskClient {
  return {
    createTask: vi.fn(
      async (input: { title: string; description: string }) => ({
        id: taskOverrides.id ?? `task-${crypto.randomUUID().slice(0, 8)}`,
        task_number: null,
        slug: "",
        title: taskOverrides.title ?? input.title,
        description: input.description,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        origin_product: "user_created",
        repository: taskOverrides.repository ?? null,
      }),
    ),
    getTaskWithLatestRun: vi.fn(async (taskId: string) => ({
      task: {
        id: taskId,
        task_number: null,
        slug: "",
        title: "parent",
        description: "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        origin_product: "user_created",
        repository: taskOverrides.repository ?? null,
      },
      latestRun: null,
    })),
  } as unknown as CloudTaskClient;
}

describe("HogletService", () => {
  let repo: ReturnType<typeof createMockRepo>;
  let router: AffinityRouterService;
  let prDeps: ReturnType<typeof createMockPrDependencyRepository>;
  let cloudTasks: CloudTaskClient;
  let service: HogletService;

  beforeEach(() => {
    repo = createMockRepo();
    router = createMockAffinityRouter(null);
    prDeps = createMockPrDependencyRepository();
    cloudTasks = createMockCloudTaskClient();
    service = new HogletService(
      repo,
      router,
      prDeps as unknown as PrDependencyRepository,
      cloudTasks,
    );
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
      bucket: { kind: "wild" },
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

  it("filters list output by scope", async () => {
    service.recordAdhoc({ taskId: "task-1" });
    service.recordAdhoc({ taskId: "task-2" });
    await service.recordSignalBacked({
      taskId: "task-signal-1",
      signalReportId: "sr-1",
    });

    expect(service.list({ wildOnly: true })).toHaveLength(2);
    expect(service.list({ signalStagingOnly: true })).toHaveLength(1);

    repo._hoglets.set(
      "nested",
      makeHoglet({ id: "nested", taskId: "task-3", nestId: "nest-A" }),
    );
    expect(service.list({ nestId: "nest-A" })).toHaveLength(1);
    expect(service.list({ wildOnly: true })).toHaveLength(2);
    expect(service.list({ signalStagingOnly: true })).toHaveLength(1);
  });

  it("rejects list calls without scope", () => {
    expect(() => service.list({})).toThrowError(
      "hoglets.list requires wildOnly, signalStagingOnly, or nestId",
    );
  });

  describe("adopt", () => {
    it("emits removed for wild + upsert for the target nest", () => {
      const wild = service.recordAdhoc({ taskId: "task-1" });
      const listener = vi.fn();
      service.on(HedgemonyEvent.HogletChanged, listener);

      const adopted = service.adopt({
        hogletId: wild.id,
        nestId: "nest-A",
      });

      expect(adopted.nestId).toBe("nest-A");
      expect(listener).toHaveBeenNthCalledWith(1, {
        bucket: { kind: "wild" },
        event: { kind: "removed", hogletId: wild.id },
      });
      expect(listener).toHaveBeenNthCalledWith(2, {
        bucket: { kind: "nest", nestId: "nest-A" },
        event: { kind: "upsert", hoglet: adopted },
      });
    });

    it("is idempotent when the hoglet is already in the target nest", () => {
      const wild = service.recordAdhoc({ taskId: "task-1" });
      const first = service.adopt({ hogletId: wild.id, nestId: "nest-A" });

      const listener = vi.fn();
      service.on(HedgemonyEvent.HogletChanged, listener);
      const second = service.adopt({ hogletId: wild.id, nestId: "nest-A" });

      expect(second.id).toBe(first.id);
      expect(listener).not.toHaveBeenCalled();
    });

    it("rejects nest→nest direct transfer", () => {
      const wild = service.recordAdhoc({ taskId: "task-1" });
      service.adopt({ hogletId: wild.id, nestId: "nest-A" });

      expect(() =>
        service.adopt({ hogletId: wild.id, nestId: "nest-B" }),
      ).toThrowError("hoglet_already_adopted");
    });

    it("throws on unknown hoglets", () => {
      expect(() =>
        service.adopt({ hogletId: "missing", nestId: "nest-A" }),
      ).toThrowError("hoglet_not_found");
    });

    it("throws on deleted hoglets", () => {
      const wild = service.recordAdhoc({ taskId: "task-1" });
      const current = repo._hoglets.get(wild.id);
      if (!current) throw new Error("test setup");
      repo._hoglets.set(wild.id, {
        ...current,
        deletedAt: new Date().toISOString(),
      });

      expect(() =>
        service.adopt({ hogletId: wild.id, nestId: "nest-A" }),
      ).toThrowError("hoglet_deleted");
    });
  });

  describe("release", () => {
    it("emits removed for the source nest + upsert for wild", () => {
      const wild = service.recordAdhoc({ taskId: "task-1" });
      const adopted = service.adopt({ hogletId: wild.id, nestId: "nest-A" });

      const listener = vi.fn();
      service.on(HedgemonyEvent.HogletChanged, listener);
      const released = service.release({ hogletId: adopted.id });

      expect(released.nestId).toBeNull();
      expect(listener).toHaveBeenNthCalledWith(1, {
        bucket: { kind: "nest", nestId: "nest-A" },
        event: { kind: "removed", hogletId: adopted.id },
      });
      expect(listener).toHaveBeenNthCalledWith(2, {
        bucket: { kind: "wild" },
        event: { kind: "upsert", hoglet: released },
      });
    });

    it("routes signal-backed hoglets back to signal-staging on release", async () => {
      const signal = await service.recordSignalBacked({
        taskId: "task-1",
        signalReportId: "sr-1",
      });
      const adopted = service.adopt({ hogletId: signal.id, nestId: "nest-A" });

      const listener = vi.fn();
      service.on(HedgemonyEvent.HogletChanged, listener);
      const released = service.release({ hogletId: adopted.id });

      expect(released.signalReportId).toBe("sr-1");
      expect(released.nestId).toBeNull();
      expect(listener).toHaveBeenNthCalledWith(1, {
        bucket: { kind: "nest", nestId: "nest-A" },
        event: { kind: "removed", hogletId: adopted.id },
      });
      expect(listener).toHaveBeenNthCalledWith(2, {
        bucket: { kind: "signal_staging" },
        event: { kind: "upsert", hoglet: released },
      });
    });

    it("is a no-op for already-wild hoglets", () => {
      const wild = service.recordAdhoc({ taskId: "task-1" });
      const listener = vi.fn();
      service.on(HedgemonyEvent.HogletChanged, listener);

      const result = service.release({ hogletId: wild.id });

      expect(result.id).toBe(wild.id);
      expect(result.nestId).toBeNull();
      expect(listener).not.toHaveBeenCalled();
    });

    it("throws on unknown hoglets", () => {
      expect(() => service.release({ hogletId: "missing" })).toThrowError(
        "hoglet_not_found",
      );
    });
  });

  describe("recordSignalBacked", () => {
    it("records a signal-backed hoglet and emits a signal_staging event", async () => {
      const listener = vi.fn();
      service.on(HedgemonyEvent.HogletChanged, listener);

      const hoglet = await service.recordSignalBacked({
        taskId: "task-1",
        signalReportId: "sr-1",
      });

      expect(repo.create).toHaveBeenCalledWith({
        taskId: "task-1",
        nestId: null,
        signalReportId: "sr-1",
        affinityScore: null,
      });
      expect(hoglet).toMatchObject({
        taskId: "task-1",
        nestId: null,
        signalReportId: "sr-1",
        affinityScore: null,
      });
      expect(listener).toHaveBeenCalledWith({
        bucket: { kind: "signal_staging" },
        event: { kind: "upsert", hoglet },
      });
    });

    it("auto-routes the hoglet into a nest when the router returns a match", async () => {
      router = createMockAffinityRouter({
        nestId: "nest-checkout",
        score: 0.82,
      });
      service = new HogletService(
        repo,
        router,
        prDeps as unknown as PrDependencyRepository,
        cloudTasks,
      );
      const listener = vi.fn();
      service.on(HedgemonyEvent.HogletChanged, listener);

      const hoglet = await service.recordSignalBacked({
        taskId: "task-1",
        signalReportId: "sr-1",
      });

      expect(repo.create).toHaveBeenCalledWith({
        taskId: "task-1",
        nestId: "nest-checkout",
        signalReportId: "sr-1",
        affinityScore: 0.82,
      });
      expect(hoglet.nestId).toBe("nest-checkout");
      expect(hoglet.affinityScore).toBe(0.82);
      expect(listener).toHaveBeenCalledWith({
        bucket: { kind: "nest", nestId: "nest-checkout" },
        event: { kind: "upsert", hoglet },
      });
    });

    it("does not enforce the staging cap when the router places the hoglet in a nest", async () => {
      // Fill staging to the cap, then route the next one — should succeed.
      for (let i = 0; i < MAX_SIGNAL_STAGING_HOGLETS; i++) {
        await service.recordSignalBacked({
          taskId: `task-${i}`,
          signalReportId: `sr-${i}`,
        });
      }
      router = createMockAffinityRouter({ nestId: "nest-A", score: 0.9 });
      service = new HogletService(
        repo,
        router,
        prDeps as unknown as PrDependencyRepository,
        cloudTasks,
      );
      const routed = await service.recordSignalBacked({
        taskId: "task-routed",
        signalReportId: "sr-routed",
      });
      expect(routed.nestId).toBe("nest-A");
    });

    it("is idempotent for the same signalReportId", async () => {
      const first = await service.recordSignalBacked({
        taskId: "task-1",
        signalReportId: "sr-1",
      });
      const second = await service.recordSignalBacked({
        taskId: "task-2-different",
        signalReportId: "sr-1",
      });

      expect(second.id).toBe(first.id);
      expect(repo.create).toHaveBeenCalledTimes(1);
    });

    it("returns the existing hoglet when taskId is already recorded", async () => {
      const adhoc = service.recordAdhoc({ taskId: "task-1" });
      const signal = await service.recordSignalBacked({
        taskId: "task-1",
        signalReportId: "sr-1",
      });

      expect(signal.id).toBe(adhoc.id);
      expect(repo.create).toHaveBeenCalledTimes(1);
    });

    it("enforces the signal staging cap", async () => {
      for (let i = 0; i < MAX_SIGNAL_STAGING_HOGLETS; i++) {
        await service.recordSignalBacked({
          taskId: `task-${i}`,
          signalReportId: `sr-${i}`,
        });
      }

      await expect(
        service.recordSignalBacked({
          taskId: "task-overflow",
          signalReportId: "sr-overflow",
        }),
      ).rejects.toThrowError("signal_staging_cap_reached");
    });

    it("emits removed from signal_staging when adopting a signal-backed hoglet", async () => {
      const signal = await service.recordSignalBacked({
        taskId: "task-1",
        signalReportId: "sr-1",
      });

      const listener = vi.fn();
      service.on(HedgemonyEvent.HogletChanged, listener);
      const adopted = service.adopt({ hogletId: signal.id, nestId: "nest-A" });

      expect(adopted.nestId).toBe("nest-A");
      expect(listener).toHaveBeenNthCalledWith(1, {
        bucket: { kind: "signal_staging" },
        event: { kind: "removed", hogletId: signal.id },
      });
      expect(listener).toHaveBeenNthCalledWith(2, {
        bucket: { kind: "nest", nestId: "nest-A" },
        event: { kind: "upsert", hoglet: adopted },
      });
    });
  });

  describe("affinity score clearing", () => {
    it("clears affinityScore on adopt", async () => {
      router = createMockAffinityRouter({ nestId: "nest-A", score: 0.9 });
      service = new HogletService(
        repo,
        router,
        prDeps as unknown as PrDependencyRepository,
        cloudTasks,
      );
      const routed = await service.recordSignalBacked({
        taskId: "task-1",
        signalReportId: "sr-1",
      });
      expect(routed.affinityScore).toBe(0.9);

      // Release first (router placed it in nest-A; manually move it back).
      const released = service.release({ hogletId: routed.id });
      expect(released.affinityScore).toBeNull();

      // Now adopt manually — score must remain null.
      const adopted = service.adopt({ hogletId: routed.id, nestId: "nest-B" });
      expect(adopted.affinityScore).toBeNull();
    });

    it("clears affinityScore on release", async () => {
      router = createMockAffinityRouter({ nestId: "nest-A", score: 0.75 });
      service = new HogletService(
        repo,
        router,
        prDeps as unknown as PrDependencyRepository,
        cloudTasks,
      );
      const routed = await service.recordSignalBacked({
        taskId: "task-1",
        signalReportId: "sr-1",
      });
      const released = service.release({ hogletId: routed.id });
      expect(released.affinityScore).toBeNull();
    });
  });

  describe("dismissSignal", () => {
    it("soft-deletes a signal-backed hoglet and emits removal", async () => {
      const signal = await service.recordSignalBacked({
        taskId: "task-1",
        signalReportId: "sr-1",
      });

      const listener = vi.fn();
      service.on(HedgemonyEvent.HogletChanged, listener);
      service.dismissSignal({ hogletId: signal.id });

      expect(repo.softDelete).toHaveBeenCalledWith(signal.id);
      expect(listener).toHaveBeenCalledWith({
        bucket: { kind: "signal_staging" },
        event: { kind: "removed", hogletId: signal.id },
      });
    });

    it("rejects non-signal-backed hoglets", () => {
      const wild = service.recordAdhoc({ taskId: "task-1" });

      expect(() => service.dismissSignal({ hogletId: wild.id })).toThrowError(
        "hoglet_not_signal_backed",
      );
    });

    it("throws on unknown hoglets", () => {
      expect(() => service.dismissSignal({ hogletId: "missing" })).toThrowError(
        "hoglet_not_found",
      );
    });
  });

  describe("spawnFollowUp", () => {
    it("creates a follow-up hoglet and pr_dependency edge", async () => {
      cloudTasks = createMockCloudTaskClient({
        id: "child-task-1",
        repository: "org/repo",
      });
      service = new HogletService(
        repo,
        router,
        prDeps as unknown as PrDependencyRepository,
        cloudTasks,
      );

      const listener = vi.fn();
      service.on(HedgemonyEvent.HogletChanged, listener);

      const child = await service.spawnFollowUp({
        nestId: "nest-1",
        parentTaskId: "parent-task-1",
        prompt: "Address late feedback",
        payloadRef: "pr-comment:12345",
      });

      expect(cloudTasks.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Address late feedback",
          repository: "org/repo",
        }),
      );
      expect(child).toMatchObject({
        taskId: "child-task-1",
        nestId: "nest-1",
        signalReportId: null,
      });
      expect(prDeps._rows).toHaveLength(1);
      expect(prDeps._rows[0]).toMatchObject({
        nestId: "nest-1",
        parentTaskId: "parent-task-1",
        childTaskId: "child-task-1",
        state: "follow_up",
      });
      expect(listener).toHaveBeenCalledWith({
        bucket: { kind: "nest", nestId: "nest-1" },
        event: { kind: "upsert", hoglet: child },
      });
    });
  });
});

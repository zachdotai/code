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

vi.mock("./hoglet-runtime-preferences", async () => {
  const schemas =
    await vi.importActual<typeof import("./schemas")>("./schemas");
  return {
    readUserTaskPreferences: vi.fn(() => ({})),
    resolveHogletRuntime: vi.fn((loadout, preferences) => {
      const runtimeAdapter =
        loadout.runtimeAdapter ??
        preferences.runtimeAdapter ??
        schemas.DEFAULT_HOGLET_RUNTIME_ADAPTER;
      const preferredModel =
        preferences.runtimeAdapter === runtimeAdapter
          ? preferences.model
          : undefined;
      return {
        runtimeAdapter,
        model:
          loadout.model ??
          preferredModel ??
          schemas.defaultModelForAdapter(runtimeAdapter),
        reasoningEffort: schemas.clampReasoningEffortForAdapter(
          loadout.reasoningEffort ??
            preferences.reasoningEffort ??
            schemas.defaultReasoningEffortForAdapter(runtimeAdapter),
          runtimeAdapter,
        ),
        executionMode:
          loadout.executionMode ??
          (runtimeAdapter === "codex" ? "full-access" : "bypassPermissions"),
        environment: loadout.environment ?? schemas.DEFAULT_HOGLET_ENVIRONMENT,
      };
    }),
  };
});

import type { HogletRepository } from "../../db/repositories/hoglet-repository";
import type { NestRepository } from "../../db/repositories/nest-repository";
import type { PrDependencyRepository } from "../../db/repositories/pr-dependency-repository";
import { createMockPrDependencyRepository } from "../../db/repositories/pr-dependency-repository.mock";
import type { WorkspaceService } from "../workspace/service";
import type { AffinityRouterService } from "./affinity-router";
import type { CloudTaskClient } from "./cloud-task-client";
import { readUserTaskPreferences } from "./hoglet-runtime-preferences";
import {
  HogletService,
  MAX_NEST_HOGLETS,
  MAX_WILD_HOGLETS,
} from "./hoglet-service";
import type { PrGraphService } from "./pr-graph-service";
import {
  DEFAULT_CLAUDE_REASONING_EFFORT,
  DEFAULT_CODEX_REASONING_EFFORT,
  DEFAULT_HOGLET_MODEL,
  defaultModelForAdapter,
  HedgemonyEvent,
  type Hoglet,
  type Nest,
} from "./schemas";

function createMockPrGraphService(): PrGraphService {
  return {
    unlinkAllForTask: vi.fn(),
  } as unknown as PrGraphService;
}

function createMockWorkspaceService(): WorkspaceService {
  return {
    createWorkspace: vi.fn(
      async (input: { taskId: string; branch?: string }) => ({
        taskId: input.taskId,
        mode: "cloud",
        worktree: null,
        branchName: input.branch ?? null,
        linkedBranch: null,
      }),
    ),
  } as unknown as WorkspaceService;
}

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

function makeNest(overrides: Partial<Nest> = {}): Nest {
  const now = "2026-05-13T00:00:00.000Z";
  return {
    id: "nest-1",
    name: "Checkout lift",
    goalPrompt: "Improve checkout conversion",
    definitionOfDone: null,
    mapX: 0,
    mapY: 0,
    status: "active",
    health: "ok",
    targetMetricId: null,
    loadoutJson: "{}",
    primaryRepository: null,
    createdAt: now,
    updatedAt: now,
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
      [...hoglets.values()].filter((h) => h.nestId === null && !h.deletedAt),
    ),
    findAllForNest: vi.fn((nestId: string) =>
      [...hoglets.values()].filter((h) => h.nestId === nestId && !h.deletedAt),
    ),
    countWild: vi.fn(
      () =>
        [...hoglets.values()].filter((h) => h.nestId === null && !h.deletedAt)
          .length,
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
      [...hoglets.values()].flatMap((hoglet) => {
        if (!hoglet.name || hoglet.deletedAt) return [];
        return [hoglet.name];
      }),
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

function createMockNestRepository(
  nest: Nest | null = makeNest(),
): NestRepository {
  return {
    findById: vi.fn(() => nest),
  } as unknown as NestRepository;
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
    createTaskRun: vi.fn(async () => ({
      id: `run-${crypto.randomUUID().slice(0, 8)}`,
      status: "not_started",
    })),
    startTaskRun: vi.fn(async () => ({})),
    updateTaskRun: vi.fn(
      async (_taskId: string, runId: string, patch: { status?: string }) => ({
        id: runId,
        status: patch.status ?? "not_started",
      }),
    ),
    deleteTask: vi.fn(async () => undefined),
    resolveGithubUserIntegration: vi.fn(async () => "user-integration-auto"),
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
  let nestRepository: NestRepository;
  let cloudTasks: CloudTaskClient;
  let workspaceService: WorkspaceService;
  let service: HogletService;

  beforeEach(() => {
    (readUserTaskPreferences as ReturnType<typeof vi.fn>).mockReturnValue({});
    repo = createMockRepo();
    router = createMockAffinityRouter(null);
    prDeps = createMockPrDependencyRepository();
    nestRepository = createMockNestRepository();
    cloudTasks = createMockCloudTaskClient();
    workspaceService = createMockWorkspaceService();
    service = new HogletService(
      repo,
      router,
      prDeps as unknown as PrDependencyRepository,
      nestRepository,
      cloudTasks,
      createMockPrGraphService(),
      workspaceService,
    );
  });

  it("records an adhoc hoglet and emits a wild change event", () => {
    const listener = vi.fn();
    service.on(HedgemonyEvent.HogletChanged, listener);

    const hoglet = service.recordAdhoc({ taskId: "task-1" });

    expect(repo.create).toHaveBeenCalledWith({
      taskId: "task-1",
      name: expect.any(String),
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

  it("can emit an upsert change for an existing hoglet", () => {
    const hoglet = service.recordAdhoc({ taskId: "task-1" });
    const listener = vi.fn();
    service.on(HedgemonyEvent.HogletChanged, listener);

    service.emitChanged(hoglet);

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

    // Wild covers both ad-hoc spawns and signal-backed unrouted hoglets.
    expect(service.list({ wildOnly: true })).toHaveLength(3);

    repo._hoglets.set(
      "nested",
      makeHoglet({ id: "nested", taskId: "task-3", nestId: "nest-A" }),
    );
    expect(service.list({ nestId: "nest-A" })).toHaveLength(1);
    expect(service.list({ wildOnly: true })).toHaveLength(3);
  });

  it("rejects list calls without scope", () => {
    expect(() => service.list({})).toThrowError(
      "hoglets.list requires wildOnly or nestId",
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

    it("routes signal-backed hoglets back to wild on release", async () => {
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
        bucket: { kind: "wild" },
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
    it("records a signal-backed hoglet and emits a wild event when unrouted", async () => {
      const listener = vi.fn();
      service.on(HedgemonyEvent.HogletChanged, listener);

      const hoglet = await service.recordSignalBacked({
        taskId: "task-1",
        signalReportId: "sr-1",
      });

      expect(repo.create).toHaveBeenCalledWith({
        taskId: "task-1",
        name: expect.any(String),
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
        bucket: { kind: "wild" },
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
        nestRepository,
        cloudTasks,
        createMockPrGraphService(),
        workspaceService,
      );
      const listener = vi.fn();
      service.on(HedgemonyEvent.HogletChanged, listener);

      const hoglet = await service.recordSignalBacked({
        taskId: "task-1",
        signalReportId: "sr-1",
      });

      expect(repo.create).toHaveBeenCalledWith({
        taskId: "task-1",
        name: expect.any(String),
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

    it("does not enforce the wild cap when the router places the hoglet in a nest", async () => {
      // Fill wild to the cap, then route the next one — should succeed.
      for (let i = 0; i < MAX_WILD_HOGLETS; i++) {
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
        nestRepository,
        cloudTasks,
        createMockPrGraphService(),
        workspaceService,
      );
      const routed = await service.recordSignalBacked({
        taskId: "task-routed",
        signalReportId: "sr-routed",
      });
      expect(routed.nestId).toBe("nest-A");
    });

    it("enforces the nest cap before auto-routing signal-backed hoglets", async () => {
      for (let i = 0; i < MAX_NEST_HOGLETS; i++) {
        repo._hoglets.set(
          `h-${i}`,
          makeHoglet({ id: `h-${i}`, taskId: `t-${i}`, nestId: "nest-A" }),
        );
      }
      router = createMockAffinityRouter({ nestId: "nest-A", score: 0.9 });
      service = new HogletService(
        repo,
        router,
        prDeps as unknown as PrDependencyRepository,
        nestRepository,
        cloudTasks,
        createMockPrGraphService(),
        workspaceService,
      );

      await expect(
        service.recordSignalBacked({
          taskId: "task-routed-overflow",
          signalReportId: "sr-routed-overflow",
        }),
      ).rejects.toThrowError("nest_hoglet_cap_reached");
      expect(repo.create).not.toHaveBeenCalled();
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

    it("enforces the shared wild cap on unrouted signal-backed hoglets", async () => {
      for (let i = 0; i < MAX_WILD_HOGLETS; i++) {
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
      ).rejects.toThrowError("wild_hoglet_cap_reached");
    });

    it("emits removed from wild when adopting a signal-backed hoglet", async () => {
      const signal = await service.recordSignalBacked({
        taskId: "task-1",
        signalReportId: "sr-1",
      });

      const listener = vi.fn();
      service.on(HedgemonyEvent.HogletChanged, listener);
      const adopted = service.adopt({ hogletId: signal.id, nestId: "nest-A" });

      expect(adopted.nestId).toBe("nest-A");
      expect(listener).toHaveBeenNthCalledWith(1, {
        bucket: { kind: "wild" },
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
        nestRepository,
        cloudTasks,
        createMockPrGraphService(),
        workspaceService,
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
        nestRepository,
        cloudTasks,
        createMockPrGraphService(),
        workspaceService,
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
    it("soft-deletes a signal-backed hoglet and emits removal from wild", async () => {
      const signal = await service.recordSignalBacked({
        taskId: "task-1",
        signalReportId: "sr-1",
      });

      const listener = vi.fn();
      service.on(HedgemonyEvent.HogletChanged, listener);
      service.dismissSignal({ hogletId: signal.id });

      expect(repo.softDelete).toHaveBeenCalledWith(signal.id);
      expect(listener).toHaveBeenCalledWith({
        bucket: { kind: "wild" },
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

  describe("retire", () => {
    it("soft-deletes a wild hoglet and emits removal from the wild bucket", () => {
      const wild = service.recordAdhoc({ taskId: "task-1" });

      const listener = vi.fn();
      service.on(HedgemonyEvent.HogletChanged, listener);
      service.retire({ hogletId: wild.id });

      expect(repo.softDelete).toHaveBeenCalledWith(wild.id);
      expect(listener).toHaveBeenCalledWith({
        bucket: { kind: "wild" },
        event: { kind: "removed", hogletId: wild.id },
      });
    });

    it("soft-deletes an unrouted signal-backed hoglet and emits from wild", async () => {
      const signal = await service.recordSignalBacked({
        taskId: "task-2",
        signalReportId: "sr-2",
      });

      const listener = vi.fn();
      service.on(HedgemonyEvent.HogletChanged, listener);
      service.retire({ hogletId: signal.id });

      expect(repo.softDelete).toHaveBeenCalledWith(signal.id);
      expect(listener).toHaveBeenCalledWith({
        bucket: { kind: "wild" },
        event: { kind: "removed", hogletId: signal.id },
      });
    });

    it("soft-deletes a nested hoglet and emits from that nest's bucket", () => {
      const wild = service.recordAdhoc({ taskId: "task-3" });
      const adopted = service.adopt({ hogletId: wild.id, nestId: "nest-X" });

      const listener = vi.fn();
      service.on(HedgemonyEvent.HogletChanged, listener);
      service.retire({ hogletId: adopted.id });

      expect(repo.softDelete).toHaveBeenCalledWith(adopted.id);
      expect(listener).toHaveBeenCalledWith({
        bucket: { kind: "nest", nestId: "nest-X" },
        event: { kind: "removed", hogletId: adopted.id },
      });
    });

    it("throws on unknown hoglets", () => {
      expect(() => service.retire({ hogletId: "missing" })).toThrowError(
        "hoglet_not_found",
      );
    });

    it("is a no-op on already-deleted hoglets", () => {
      const wild = service.recordAdhoc({ taskId: "task-4" });
      service.retire({ hogletId: wild.id });

      const listener = vi.fn();
      service.on(HedgemonyEvent.HogletChanged, listener);
      service.retire({ hogletId: wild.id });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("spawnInNest", () => {
    it("creates a cloud task + run, then inserts the sidecar row", async () => {
      cloudTasks = createMockCloudTaskClient({ id: "cloud-task-1" });
      service = new HogletService(
        repo,
        router,
        prDeps as unknown as PrDependencyRepository,
        nestRepository,
        cloudTasks,
        createMockPrGraphService(),
        workspaceService,
      );
      const listener = vi.fn();
      service.on(HedgemonyEvent.HogletChanged, listener);

      const { hoglet, taskRunId } = await service.spawnInNest({
        nestId: "nest-1",
        prompt: "Build the checkout page",
      });

      expect(cloudTasks.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Build the checkout page",
          description: "Build the checkout page",
          repository: null,
          originProduct: "automation",
          githubUserIntegration: null,
        }),
      );
      expect(cloudTasks.createTaskRun).toHaveBeenCalledWith(
        "cloud-task-1",
        expect.objectContaining({
          environment: "cloud",
          mode: "background",
          runtimeAdapter: "claude",
          model: DEFAULT_HOGLET_MODEL,
          reasoningEffort: DEFAULT_CLAUDE_REASONING_EFFORT,
          initialPermissionMode: "bypassPermissions",
          prAuthorshipMode: "bot",
        }),
      );
      expect(cloudTasks.startTaskRun).toHaveBeenCalledWith(
        "cloud-task-1",
        expect.any(String),
        { pendingUserMessage: "Build the checkout page" },
      );
      expect(workspaceService.createWorkspace).toHaveBeenCalledWith({
        taskId: "cloud-task-1",
        mainRepoPath: "",
        folderId: "",
        folderPath: "",
        mode: "cloud",
        branch: undefined,
      });
      expect(hoglet.taskId).toBe("cloud-task-1");
      expect(hoglet.nestId).toBe("nest-1");
      expect(taskRunId).toBeTruthy();
      expect(listener).toHaveBeenCalledWith({
        bucket: { kind: "nest", nestId: "nest-1" },
        event: { kind: "upsert", hoglet },
      });
    });

    it("passes loadout model and runtimeAdapter to the cloud run", async () => {
      cloudTasks = createMockCloudTaskClient({ id: "cloud-task-2" });
      service = new HogletService(
        repo,
        router,
        prDeps as unknown as PrDependencyRepository,
        nestRepository,
        cloudTasks,
        createMockPrGraphService(),
        workspaceService,
      );

      await service.spawnInNest(
        { nestId: "nest-1", prompt: "work" },
        {
          model: defaultModelForAdapter("codex"),
          runtimeAdapter: "codex",
          reasoningEffort: "high",
          executionMode: "full-access",
        },
      );

      expect(cloudTasks.createTaskRun).toHaveBeenCalledWith(
        "cloud-task-2",
        expect.objectContaining({
          model: defaultModelForAdapter("codex"),
          runtimeAdapter: "codex",
          reasoningEffort: "high",
          initialPermissionMode: "full-access",
        }),
      );
    });

    it("defaults to codex model when runtimeAdapter is codex without explicit model", async () => {
      cloudTasks = createMockCloudTaskClient({ id: "cloud-task-codex" });
      service = new HogletService(
        repo,
        router,
        prDeps as unknown as PrDependencyRepository,
        nestRepository,
        cloudTasks,
        createMockPrGraphService(),
        workspaceService,
      );

      await service.spawnInNest(
        { nestId: "nest-1", prompt: "work" },
        { runtimeAdapter: "codex" },
      );

      expect(cloudTasks.createTaskRun).toHaveBeenCalledWith(
        "cloud-task-codex",
        expect.objectContaining({
          model: defaultModelForAdapter("codex"),
          runtimeAdapter: "codex",
          reasoningEffort: DEFAULT_CODEX_REASONING_EFFORT,
          initialPermissionMode: "full-access",
        }),
      );
    });

    it("uses user task preferences when loadout is empty", async () => {
      (readUserTaskPreferences as ReturnType<typeof vi.fn>).mockReturnValue({
        runtimeAdapter: "codex",
        reasoningEffort: "medium",
      });
      cloudTasks = createMockCloudTaskClient({ id: "cloud-task-prefs" });
      service = new HogletService(
        repo,
        router,
        prDeps as unknown as PrDependencyRepository,
        nestRepository,
        cloudTasks,
        createMockPrGraphService(),
        workspaceService,
      );

      await service.spawnInNest({ nestId: "nest-1", prompt: "work" });

      expect(cloudTasks.createTaskRun).toHaveBeenCalledWith(
        "cloud-task-prefs",
        expect.objectContaining({
          model: defaultModelForAdapter("codex"),
          runtimeAdapter: "codex",
          reasoningEffort: "medium",
          initialPermissionMode: "full-access",
        }),
      );
    });

    it("passes repository and resolved githubUserIntegration to createTask", async () => {
      cloudTasks = createMockCloudTaskClient();
      service = new HogletService(
        repo,
        router,
        prDeps as unknown as PrDependencyRepository,
        nestRepository,
        cloudTasks,
        createMockPrGraphService(),
        workspaceService,
      );

      await service.spawnInNest({
        nestId: "nest-1",
        prompt: "work",
        repository: "posthog/posthog",
      });

      expect(cloudTasks.resolveGithubUserIntegration).toHaveBeenCalledWith(
        "posthog/posthog",
      );
      expect(cloudTasks.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          repository: "posthog/posthog",
          githubUserIntegration: "user-integration-auto",
        }),
      );
    });

    it("does not resolve githubUserIntegration when no repository is provided", async () => {
      cloudTasks = createMockCloudTaskClient();
      service = new HogletService(
        repo,
        router,
        prDeps as unknown as PrDependencyRepository,
        nestRepository,
        cloudTasks,
        createMockPrGraphService(),
        workspaceService,
      );

      await service.spawnInNest({
        nestId: "nest-1",
        prompt: "work",
      });

      expect(cloudTasks.resolveGithubUserIntegration).not.toHaveBeenCalled();
      expect(cloudTasks.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          repository: null,
          githubUserIntegration: null,
        }),
      );
    });

    it("enforces the nest hoglet cap", async () => {
      for (let i = 0; i < MAX_NEST_HOGLETS; i++) {
        repo._hoglets.set(
          `h-${i}`,
          makeHoglet({ id: `h-${i}`, taskId: `t-${i}`, nestId: "nest-1" }),
        );
      }

      await expect(
        service.spawnInNest({ nestId: "nest-1", prompt: "overflow" }),
      ).rejects.toThrowError("nest_hoglet_cap_reached");
      expect(cloudTasks.createTask).not.toHaveBeenCalled();
    });

    it("does not insert sidecar row when createTaskRun fails", async () => {
      cloudTasks = createMockCloudTaskClient({ id: "cloud-fail" });
      (cloudTasks.createTaskRun as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("cloud_unavailable"),
      );
      service = new HogletService(
        repo,
        router,
        prDeps as unknown as PrDependencyRepository,
        nestRepository,
        cloudTasks,
        createMockPrGraphService(),
        workspaceService,
      );

      await expect(
        service.spawnInNest({ nestId: "nest-1", prompt: "work" }),
      ).rejects.toThrowError("cloud_unavailable");
      expect(repo.create).not.toHaveBeenCalled();
      expect(cloudTasks.deleteTask).toHaveBeenCalledWith("cloud-fail");
    });

    it("does not start the run or insert sidecar row when cloud workspace creation fails", async () => {
      cloudTasks = createMockCloudTaskClient({ id: "cloud-workspace-fail" });
      (
        workspaceService.createWorkspace as ReturnType<typeof vi.fn>
      ).mockRejectedValueOnce(new Error("workspace_failed"));
      service = new HogletService(
        repo,
        router,
        prDeps as unknown as PrDependencyRepository,
        nestRepository,
        cloudTasks,
        createMockPrGraphService(),
        workspaceService,
      );

      await expect(
        service.spawnInNest({ nestId: "nest-1", prompt: "work" }),
      ).rejects.toThrowError("workspace_failed");
      expect(cloudTasks.createTaskRun).toHaveBeenCalled();
      expect(cloudTasks.startTaskRun).not.toHaveBeenCalled();
      expect(cloudTasks.updateTaskRun).toHaveBeenCalledWith(
        "cloud-workspace-fail",
        expect.any(String),
        {
          status: "cancelled",
          errorMessage: "Cancelled after Hedgemony spawn failed",
        },
      );
      expect(cloudTasks.deleteTask).toHaveBeenCalledWith(
        "cloud-workspace-fail",
      );
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("does not insert sidecar row when startTaskRun fails", async () => {
      cloudTasks = createMockCloudTaskClient({ id: "cloud-fail-2" });
      (cloudTasks.startTaskRun as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("start_failed"),
      );
      service = new HogletService(
        repo,
        router,
        prDeps as unknown as PrDependencyRepository,
        nestRepository,
        cloudTasks,
        createMockPrGraphService(),
        workspaceService,
      );

      await expect(
        service.spawnInNest({ nestId: "nest-1", prompt: "work" }),
      ).rejects.toThrowError("start_failed");
      expect(cloudTasks.updateTaskRun).toHaveBeenCalledWith(
        "cloud-fail-2",
        expect.any(String),
        {
          status: "cancelled",
          errorMessage: "Cancelled after Hedgemony spawn failed",
        },
      );
      expect(cloudTasks.deleteTask).toHaveBeenCalledWith("cloud-fail-2");
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("rolls back cloud task state when local sidecar insertion fails", async () => {
      cloudTasks = createMockCloudTaskClient({ id: "cloud-local-fail" });
      (repo.create as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error("sqlite_failed");
      });
      service = new HogletService(
        repo,
        router,
        prDeps as unknown as PrDependencyRepository,
        nestRepository,
        cloudTasks,
        createMockPrGraphService(),
        workspaceService,
      );

      await expect(
        service.spawnInNest({ nestId: "nest-1", prompt: "work" }),
      ).rejects.toThrowError("sqlite_failed");
      expect(cloudTasks.updateTaskRun).toHaveBeenCalledWith(
        "cloud-local-fail",
        expect.any(String),
        {
          status: "cancelled",
          errorMessage: "Cancelled after Hedgemony spawn failed",
        },
      );
      expect(cloudTasks.deleteTask).toHaveBeenCalledWith("cloud-local-fail");
    });

    it("truncates long prompts in the task title", async () => {
      cloudTasks = createMockCloudTaskClient();
      service = new HogletService(
        repo,
        router,
        prDeps as unknown as PrDependencyRepository,
        nestRepository,
        cloudTasks,
        createMockPrGraphService(),
        workspaceService,
      );
      const longPrompt = "A".repeat(200);

      await service.spawnInNest({ nestId: "nest-1", prompt: longPrompt });

      const titleArg = (cloudTasks.createTask as ReturnType<typeof vi.fn>).mock
        .calls[0][0].title;
      expect(titleArg.length).toBeLessThanOrEqual(120);
    });

    it("clamps codex reasoning effort to high when max is specified", async () => {
      cloudTasks = createMockCloudTaskClient({ id: "cloud-task-clamp" });
      service = new HogletService(
        repo,
        router,
        prDeps as unknown as PrDependencyRepository,
        nestRepository,
        cloudTasks,
        createMockPrGraphService(),
        workspaceService,
      );

      await service.spawnInNest(
        { nestId: "nest-1", prompt: "work" },
        { runtimeAdapter: "codex", reasoningEffort: "max" },
      );

      expect(cloudTasks.createTaskRun).toHaveBeenCalledWith(
        "cloud-task-clamp",
        expect.objectContaining({
          runtimeAdapter: "codex",
          reasoningEffort: "high",
        }),
      );
    });
  });

  describe("spawnFollowUp", () => {
    it("enforces the nest hoglet cap before fetching the parent task", async () => {
      for (let i = 0; i < MAX_NEST_HOGLETS; i++) {
        repo._hoglets.set(
          `h-${i}`,
          makeHoglet({ id: `h-${i}`, taskId: `t-${i}`, nestId: "nest-1" }),
        );
      }

      await expect(
        service.spawnFollowUp({
          nestId: "nest-1",
          parentTaskId: "parent-task-1",
          prompt: "Address late feedback",
          payloadRef: "pr-comment:12345",
        }),
      ).rejects.toThrowError("nest_hoglet_cap_reached");
      expect(cloudTasks.getTaskWithLatestRun).not.toHaveBeenCalled();
      expect(cloudTasks.createTask).not.toHaveBeenCalled();
    });

    it("creates a follow-up hoglet and pr_dependency edge", async () => {
      cloudTasks = createMockCloudTaskClient({
        id: "child-task-1",
        repository: "org/repo",
      });
      service = new HogletService(
        repo,
        router,
        prDeps as unknown as PrDependencyRepository,
        nestRepository,
        cloudTasks,
        createMockPrGraphService(),
        workspaceService,
      );

      const listener = vi.fn();
      service.on(HedgemonyEvent.HogletChanged, listener);

      const child = await service.spawnFollowUp(
        {
          nestId: "nest-1",
          parentTaskId: "parent-task-1",
          prompt: "Address late feedback",
          payloadRef: "pr-comment:12345",
        },
        {
          model: defaultModelForAdapter("codex"),
          runtimeAdapter: "codex",
          reasoningEffort: "high",
          executionMode: "full-access",
        },
      );

      expect(cloudTasks.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Address late feedback",
          repository: "org/repo",
          githubUserIntegration: "user-integration-auto",
        }),
      );
      expect(cloudTasks.resolveGithubUserIntegration).toHaveBeenCalledWith(
        "org/repo",
      );
      expect(cloudTasks.createTaskRun).toHaveBeenCalledWith(
        "child-task-1",
        expect.objectContaining({
          environment: "cloud",
          mode: "background",
          runtimeAdapter: "codex",
          model: defaultModelForAdapter("codex"),
          reasoningEffort: "high",
          initialPermissionMode: "full-access",
          prAuthorshipMode: "bot",
        }),
      );
      expect(workspaceService.createWorkspace).toHaveBeenCalledWith({
        taskId: "child-task-1",
        mainRepoPath: "",
        folderId: "",
        folderPath: "",
        mode: "cloud",
        branch: undefined,
      });
      expect(cloudTasks.startTaskRun).toHaveBeenCalledWith(
        "child-task-1",
        expect.any(String),
        { pendingUserMessage: "Address late feedback" },
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

    it("prefers the nest primaryRepository over a stale parent repository", async () => {
      nestRepository = createMockNestRepository(
        makeNest({ primaryRepository: "org/correct-repo" }),
      );
      cloudTasks = createMockCloudTaskClient({
        id: "child-task-corrected",
        repository: "org/stale-repo",
      });
      (
        cloudTasks.resolveGithubUserIntegration as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce("user-integration-corrected");
      service = new HogletService(
        repo,
        router,
        prDeps as unknown as PrDependencyRepository,
        nestRepository,
        cloudTasks,
        createMockPrGraphService(),
        workspaceService,
      );

      await service.spawnFollowUp({
        nestId: "nest-1",
        parentTaskId: "parent-task-1",
        prompt: "Address late feedback",
        payloadRef: "pr-comment:12345",
      });

      expect(cloudTasks.resolveGithubUserIntegration).toHaveBeenCalledWith(
        "org/correct-repo",
      );
      expect(cloudTasks.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          repository: "org/correct-repo",
          githubUserIntegration: "user-integration-corrected",
        }),
      );
    });

    it("rolls back cloud task state when follow-up workspace creation fails", async () => {
      cloudTasks = createMockCloudTaskClient({ id: "child-task-fail" });
      (
        workspaceService.createWorkspace as ReturnType<typeof vi.fn>
      ).mockRejectedValueOnce(new Error("workspace_failed"));
      service = new HogletService(
        repo,
        router,
        prDeps as unknown as PrDependencyRepository,
        nestRepository,
        cloudTasks,
        createMockPrGraphService(),
        workspaceService,
      );

      await expect(
        service.spawnFollowUp({
          nestId: "nest-1",
          parentTaskId: "parent-task-1",
          prompt: "Address late feedback",
          payloadRef: "pr-comment:12345",
        }),
      ).rejects.toThrowError("workspace_failed");
      expect(repo.create).not.toHaveBeenCalled();
      expect(prDeps._rows).toHaveLength(0);
      expect(cloudTasks.updateTaskRun).toHaveBeenCalledWith(
        "child-task-fail",
        expect.any(String),
        {
          status: "cancelled",
          errorMessage: "Cancelled after Hedgemony spawn failed",
        },
      );
      expect(cloudTasks.deleteTask).toHaveBeenCalledWith("child-task-fail");
    });

    it("soft-deletes the sidecar and rolls back cloud state when follow-up edge insert fails", async () => {
      cloudTasks = createMockCloudTaskClient({ id: "child-task-edge-fail" });
      const insert = vi.fn(() => {
        throw new Error("edge_failed");
      });
      prDeps.insert = insert as typeof prDeps.insert;
      service = new HogletService(
        repo,
        router,
        prDeps as unknown as PrDependencyRepository,
        nestRepository,
        cloudTasks,
        createMockPrGraphService(),
        workspaceService,
      );

      await expect(
        service.spawnFollowUp({
          nestId: "nest-1",
          parentTaskId: "parent-task-1",
          prompt: "Address late feedback",
          payloadRef: "pr-comment:12345",
        }),
      ).rejects.toThrowError("edge_failed");
      const created = [...repo._hoglets.values()][0];
      expect(created).toBeDefined();
      expect(created?.deletedAt).toEqual(expect.any(String));
      expect(cloudTasks.updateTaskRun).toHaveBeenCalledWith(
        "child-task-edge-fail",
        expect.any(String),
        {
          status: "cancelled",
          errorMessage: "Cancelled after Hedgemony spawn failed",
        },
      );
      expect(cloudTasks.deleteTask).toHaveBeenCalledWith(
        "child-task-edge-fail",
      );
    });
  });
});

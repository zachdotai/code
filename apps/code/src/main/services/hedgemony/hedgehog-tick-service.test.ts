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

vi.mock("../settingsStore", () => ({
  getHedgemonyMaxTicksPerHour: () => 60,
}));

import type { HedgehogStateRepository } from "../../db/repositories/hedgehog-state-repository";
import { createMockHedgehogStateRepository } from "../../db/repositories/hedgehog-state-repository.mock";
import type { OperatorDecisionRepository } from "../../db/repositories/operator-decision-repository";
import { createMockOperatorDecisionRepository } from "../../db/repositories/operator-decision-repository.mock";
import type {
  PrDependency,
  PrDependencyRepository,
} from "../../db/repositories/pr-dependency-repository";
import { createMockPrDependencyRepository } from "../../db/repositories/pr-dependency-repository.mock";
import type {
  Repository,
  RepositoryRepository,
} from "../../db/repositories/repository-repository";
import type { TickLogRepository } from "../../db/repositories/tick-log-repository";
import { createMockTickLogRepository } from "../../db/repositories/tick-log-repository.mock";
import type { GitService } from "../git/service";
import type {
  AnthropicToolUseBlock,
  PromptWithToolsOutput,
} from "../llm-gateway/schemas";
import type { LlmGatewayService } from "../llm-gateway/service";
import type { CloudTaskClient } from "./cloud-task-client";
import type { FeedbackRoutingService } from "./feedback-routing-service";
import { HedgehogTickService } from "./hedgehog-tick-service";
import { readUserTaskPreferences } from "./hoglet-runtime-preferences";
import type { HogletService } from "./hoglet-service";
import type { NestChatService } from "./nest-chat-service";
import type { NestService } from "./nest-service";
import type { PrGraphService } from "./pr-graph-service";
import {
  DEFAULT_CODEX_REASONING_EFFORT,
  defaultModelForAdapter,
  HedgemonyEvent,
  type HedgemonyEvents,
  type Hoglet,
  type Nest,
  type NestMessage,
} from "./schemas";

type AnyListener = (payload: unknown) => void;

function makeNest(overrides: Partial<Nest> = {}): Nest {
  return {
    id: "nest-1",
    name: "Checkout lift",
    goalPrompt: "Improve checkout conversion.",
    definitionOfDone: "Conversion improves and docs are updated.",
    mapX: 0,
    mapY: 0,
    status: "active",
    health: "ok",
    targetMetricId: null,
    loadoutJson: null,
    primaryRepository: null,
    createdAt: "2026-05-13T00:00:00.000Z",
    updatedAt: "2026-05-13T00:00:00.000Z",
    ...overrides,
  };
}

function makeHoglet(overrides: Partial<Hoglet> = {}): Hoglet {
  return {
    id: `hoglet-${crypto.randomUUID().slice(0, 8)}`,
    name: null,
    taskId: `task-${crypto.randomUUID().slice(0, 8)}`,
    nestId: "nest-1",
    signalReportId: null,
    affinityScore: null,
    createdAt: "2026-05-13T00:00:00.000Z",
    updatedAt: "2026-05-13T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<NestMessage> = {}): NestMessage {
  return {
    id: `msg-${crypto.randomUUID().slice(0, 8)}`,
    nestId: "nest-1",
    kind: "audit",
    visibility: "summary",
    sourceTaskId: null,
    body: "msg",
    payloadJson: null,
    createdAt: "2026-05-13T00:00:00.000Z",
    ...overrides,
  };
}

function makePromptWithToolsResponse(
  toolUseBlocks: AnthropicToolUseBlock[],
  options: { text?: string; stopReason?: string } = {},
): PromptWithToolsOutput {
  return {
    textBlocks: options.text ? [options.text] : [],
    toolUseBlocks,
    model: "claude-sonnet-4-5",
    stopReason: options.stopReason ?? "tool_use",
    usage: { inputTokens: 200, outputTokens: 100 },
  };
}

interface Mocks {
  llm: LlmGatewayService;
  nestService: NestService;
  hogletService: HogletService;
  nestChat: NestChatService;
  cloudTasks: CloudTaskClient;
  stateRepo: HedgehogStateRepository;
  prDependencies: PrDependencyRepository;
  prGraph: PrGraphService;
  git: GitService;
  feedbackRouting: FeedbackRoutingService;
  repositoryRepo: RepositoryRepository;
  tickLog: ReturnType<typeof createMockTickLogRepository>;
  operatorDecisions: ReturnType<typeof createMockOperatorDecisionRepository>;
  emittedNestChanged: HedgemonyEvents["nest-changed"][];
}

function makeRepository(overrides: Partial<Repository> = {}): Repository {
  return {
    id: `repo-${crypto.randomUUID().slice(0, 8)}`,
    path: "/tmp/fixture-repo",
    remoteUrl: null,
    lastAccessedAt: "2026-05-13T00:00:00.000Z",
    createdAt: "2026-05-13T00:00:00.000Z",
    updatedAt: "2026-05-13T00:00:00.000Z",
    ...overrides,
  };
}

function setupMocks(input: {
  nest?: Nest;
  nests?: Nest[];
  hoglets?: Hoglet[];
  hogletStates?: Record<
    string,
    {
      status:
        | "not_started"
        | "queued"
        | "in_progress"
        | "completed"
        | "failed"
        | "cancelled";
      runId: string | null;
      prUrl?: string | null;
      repository?: string | null;
    }
  >;
  recentChat?: NestMessage[];
  prDependencies?: Array<
    Pick<PrDependency, "nestId" | "parentTaskId" | "childTaskId" | "state">
  >;
  promptResponse?: PromptWithToolsOutput;
  promptThrows?: Error;
  availableRepositories?: Repository[];
}): Mocks {
  const nests = input.nests ?? [input.nest ?? makeNest()];
  const hoglets = input.hoglets ?? [];
  const hogletStates = input.hogletStates ?? {};

  const emittedNestChanged: HedgemonyEvents["nest-changed"][] = [];
  const listeners = new Map<string, AnyListener[]>();

  const nestService = {
    list: vi.fn(() => nests),
    get: vi.fn(({ id }: { id: string }) => {
      const found = nests.find((candidate) => candidate.id === id);
      if (found) return found;
      throw new Error(`Nest not found: ${id}`);
    }),
    on: vi.fn((event: string, listener: AnyListener) => {
      const arr = listeners.get(event) ?? [];
      arr.push(listener);
      listeners.set(event, arr);
      return nestService;
    }),
    off: vi.fn((event: string, listener: AnyListener) => {
      const arr = listeners.get(event) ?? [];
      listeners.set(
        event,
        arr.filter((l) => l !== listener),
      );
      return nestService;
    }),
    emit: vi.fn((event: string, payload: unknown) => {
      if (event === HedgemonyEvent.NestChanged) {
        emittedNestChanged.push(payload as HedgemonyEvents["nest-changed"]);
      }
      for (const l of listeners.get(event) ?? []) {
        l(payload);
      }
      return true;
    }),
    emitMessageAppended: vi.fn((message: NestMessage) => {
      const payload: HedgemonyEvents["nest-changed"] = {
        nestId: message.nestId,
        event: { kind: "message_appended", message },
      };
      emittedNestChanged.push(payload);
    }),
    emitHedgehogTick: vi.fn(
      (nestId: string, state: { state: string; lastTickAt: string | null }) => {
        const payload = {
          nestId,
          event: {
            kind: "hedgehog_tick",
            state,
          },
        } as HedgemonyEvents["nest-changed"];
        emittedNestChanged.push(payload);
      },
    ),
  } as unknown as NestService;

  const hogletService = {
    list: vi.fn(() => hoglets),
    on: vi.fn(() => hogletService),
    off: vi.fn(() => hogletService),
    ensureCloudWorkspace: vi.fn(async () => undefined),
    spawnInNest: vi.fn(async () => ({
      hoglet: makeHoglet({ taskId: "spawned-task-1" }),
      taskRunId: `run-${crypto.randomUUID().slice(0, 8)}`,
    })),
  } as unknown as HogletService;

  const nestChat = {
    list: vi.fn(() => input.recentChat ?? []),
    recordHedgehogMessage: vi.fn((args) => makeMessage(args)),
  } as unknown as NestChatService;

  const cloudTasks = {
    getTaskWithLatestRun: vi.fn(async (taskId: string) => {
      const state = hogletStates[taskId];
      if (!state) {
        return {
          task: { id: taskId } as unknown as Parameters<
            CloudTaskClient["getTaskWithLatestRun"]
          >[0],
          latestRun: null,
        };
      }
      return {
        task: {
          id: taskId,
          latest_run: undefined,
          repository: state.repository ?? null,
        } as never,
        latestRun: state.runId
          ? ({
              id: state.runId,
              status: state.status,
              branch: null,
            } as never)
          : null,
      };
    }),
    createTaskRun: vi.fn(async () => ({
      id: `run-${crypto.randomUUID().slice(0, 8)}`,
      status: "not_started",
    })),
    startTaskRun: vi.fn(async () => ({})),
    updateTaskRun: vi.fn(async () => ({})),
    resolveGithubUserIntegration: vi.fn(async () => "integration-1"),
    listAccessibleRepositorySlugs: vi.fn(async () => []),
  } as unknown as CloudTaskClient;

  const llm = {
    promptWithTools: vi.fn(async () => {
      if (input.promptThrows) throw input.promptThrows;
      return input.promptResponse ?? makePromptWithToolsResponse([]);
    }),
  } as unknown as LlmGatewayService;

  const stateRepo =
    createMockHedgehogStateRepository() as unknown as HedgehogStateRepository;

  const prDepsMock = createMockPrDependencyRepository();
  for (const edge of input.prDependencies ?? []) {
    prDepsMock.insert(edge);
  }
  const prDependencies = prDepsMock as unknown as PrDependencyRepository;

  const prGraph = {
    link: vi.fn(
      (dep: { nestId: string; parentTaskId: string; childTaskId: string }) =>
        prDepsMock.insertOrIgnore({ ...dep, state: "pending" }).row,
    ),
    unlink: vi.fn(({ id }: { id: string }) => prDepsMock.delete(id)),
    unlinkAllForTask: vi.fn(),
    requestRebase: vi.fn(async () => {}),
    recordRebaseOutcome: vi.fn(),
  } as unknown as PrGraphService;

  const git = {
    getPrDetailsByUrl: vi.fn(async () => null),
  } as unknown as GitService;

  const feedbackRouting = {
    emit: vi.fn(),
    routeHedgehogPrompt: vi.fn(),
    listenerCount: vi.fn(() => 0),
  } as unknown as FeedbackRoutingService;

  const repositoryRepo = {
    findAll: vi.fn(() => input.availableRepositories ?? []),
  } as unknown as RepositoryRepository;

  const tickLog = createMockTickLogRepository();
  const operatorDecisions = createMockOperatorDecisionRepository();

  return {
    llm,
    nestService,
    hogletService,
    nestChat,
    cloudTasks,
    stateRepo,
    prDependencies,
    prGraph,
    git,
    feedbackRouting,
    repositoryRepo,
    tickLog,
    operatorDecisions,
    emittedNestChanged,
  };
}

function buildService(mocks: Mocks): HedgehogTickService {
  const usageAttribution = {
    recordHedgehogTick: vi.fn(() => ({
      inserted: true,
      costUsd: 0,
      costSource: "pricing_table" as const,
    })),
    recordHogletTurn: vi.fn(() => null),
    init: vi.fn(),
  } as unknown as ConstructorParameters<typeof HedgehogTickService>[12];
  return new HedgehogTickService(
    mocks.llm,
    mocks.nestService,
    mocks.hogletService,
    mocks.nestChat,
    mocks.stateRepo,
    mocks.cloudTasks,
    mocks.prDependencies,
    mocks.prGraph,
    mocks.git,
    mocks.feedbackRouting,
    mocks.repositoryRepo,
    mocks.tickLog as unknown as TickLogRepository,
    mocks.operatorDecisions as unknown as OperatorDecisionRepository,
    usageAttribution,
  );
}

describe("HedgehogTickService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (readUserTaskPreferences as ReturnType<typeof vi.fn>).mockReturnValue({});
  });

  it("caps ticks at 60 per nest per hour and writes a capped log row", async () => {
    const mocks = setupMocks({
      promptResponse: makePromptWithToolsResponse([
        {
          id: "tool-1",
          name: "write_audit_entry",
          input: { summary: "noop" },
        },
      ]),
    });
    // Pre-populate the log with 60 recent ticks for nest-1.
    const recent = new Date(Date.now() - 30 * 60_000).toISOString();
    for (let i = 0; i < 60; i++) {
      mocks.tickLog._logs.push({
        id: `pre-${i}`,
        nestId: "nest-1",
        tickedAt: recent,
        outcome: "completed",
      });
    }
    const service = buildService(mocks);

    await service.tick("nest-1", "test_cap");

    expect(mocks.llm.promptWithTools).not.toHaveBeenCalled();
    const cappedCount = mocks.tickLog._logs.filter(
      (l) => l.outcome === "capped",
    ).length;
    expect(cappedCount).toBe(1);
    const auditBodies = (
      mocks.nestChat.recordHedgehogMessage as ReturnType<typeof vi.fn>
    ).mock.calls
      .map(([args]) => args)
      .filter((m) => m.kind === "audit")
      .map((m) => m.body as string);
    expect(auditBodies.some((b) => b.includes("Hedgehog tick capped"))).toBe(
      true,
    );
  });

  it("writes a completed tick log row when a tick finishes normally", async () => {
    const mocks = setupMocks({
      promptResponse: makePromptWithToolsResponse([
        {
          id: "tool-1",
          name: "write_audit_entry",
          input: { summary: "ok" },
        },
      ]),
    });
    const service = buildService(mocks);

    await service.tick("nest-1", "test");

    expect(mocks.tickLog._logs).toHaveLength(1);
    expect(mocks.tickLog._logs[0]).toMatchObject({
      nestId: "nest-1",
      outcome: "completed",
    });
  });

  it("tick with no hoglets writes audit and ends idle", async () => {
    const mocks = setupMocks({
      promptResponse: makePromptWithToolsResponse([
        {
          id: "tool-1",
          name: "write_audit_entry",
          input: { summary: "Nothing to do — waiting on signals." },
        },
      ]),
    });
    const service = buildService(mocks);

    await service.tick("nest-1", "test");

    const writtenMessages = (
      mocks.nestChat.recordHedgehogMessage as ReturnType<typeof vi.fn>
    ).mock.calls.map(([args]) => args);
    expect(writtenMessages.some((m) => m.kind === "audit")).toBe(true);
    const state = mocks.stateRepo.findByNestId("nest-1");
    expect(state?.state).toBe("idle");
    expect(state?.lastTickAt).not.toBeNull();
    const tickEvents = mocks.emittedNestChanged.filter(
      (e) => e.event.kind === "hedgehog_tick",
    );
    expect(tickEvents.length).toBeGreaterThanOrEqual(2);
    const first = tickEvents[0].event as {
      kind: "hedgehog_tick";
      state: { state: string };
    };
    const last = tickEvents[tickEvents.length - 1].event as {
      kind: "hedgehog_tick";
      state: { state: string };
    };
    expect(first.state.state).toBe("ticking");
    expect(last.state.state).toBe("idle");
  });

  it("raises 3 idle hoglets when the LLM returns 3 raise_hoglet blocks", async () => {
    const idleHoglets = [
      makeHoglet({ id: "h1", taskId: "task-1" }),
      makeHoglet({ id: "h2", taskId: "task-2" }),
      makeHoglet({ id: "h3", taskId: "task-3" }),
    ];
    const mocks = setupMocks({
      hoglets: idleHoglets,
      hogletStates: {
        "task-1": { status: "completed", runId: "run-old-1" },
        "task-2": { status: "cancelled", runId: "run-old-2" },
        "task-3": { status: "failed", runId: "run-old-3" },
      },
      promptResponse: makePromptWithToolsResponse([
        {
          id: "t-1",
          name: "raise_hoglet",
          input: { hoglet_id: "h1", prompt: "go" },
        },
        {
          id: "t-2",
          name: "raise_hoglet",
          input: { hoglet_id: "h2", prompt: "go" },
        },
        {
          id: "t-3",
          name: "raise_hoglet",
          input: { hoglet_id: "h3", prompt: "go" },
        },
      ]),
    });

    const service = buildService(mocks);
    await service.tick("nest-1", "test");

    expect(mocks.cloudTasks.createTaskRun).toHaveBeenCalledTimes(3);
    expect(mocks.cloudTasks.startTaskRun).toHaveBeenCalledTimes(3);
    expect(mocks.hogletService.ensureCloudWorkspace).toHaveBeenCalledTimes(3);
    const raisedTasks = (
      mocks.cloudTasks.createTaskRun as ReturnType<typeof vi.fn>
    ).mock.calls.map(([taskId]) => taskId);
    expect(new Set(raisedTasks)).toEqual(
      new Set(["task-1", "task-2", "task-3"]),
    );

    const auditBodies = (
      mocks.nestChat.recordHedgehogMessage as ReturnType<typeof vi.fn>
    ).mock.calls
      .map(([args]) => args)
      .filter((m) => m.kind === "audit")
      .map((m) => m.body);
    expect(
      auditBodies.filter((b) => b.startsWith("Raised hoglet")),
    ).toHaveLength(3);
  });

  it("caps raise_hoglet calls at 3 per tick", async () => {
    const idleHoglets = [
      makeHoglet({ id: "h1", taskId: "task-1" }),
      makeHoglet({ id: "h2", taskId: "task-2" }),
      makeHoglet({ id: "h3", taskId: "task-3" }),
      makeHoglet({ id: "h4", taskId: "task-4" }),
    ];
    const mocks = setupMocks({
      hoglets: idleHoglets,
      hogletStates: {
        "task-1": { status: "completed", runId: "r1" },
        "task-2": { status: "completed", runId: "r2" },
        "task-3": { status: "completed", runId: "r3" },
        "task-4": { status: "completed", runId: "r4" },
      },
      promptResponse: makePromptWithToolsResponse([
        { id: "t-1", name: "raise_hoglet", input: { hoglet_id: "h1" } },
        { id: "t-2", name: "raise_hoglet", input: { hoglet_id: "h2" } },
        { id: "t-3", name: "raise_hoglet", input: { hoglet_id: "h3" } },
        { id: "t-4", name: "raise_hoglet", input: { hoglet_id: "h4" } },
      ]),
    });

    const service = buildService(mocks);
    await service.tick("nest-1", "test");

    expect(mocks.cloudTasks.createTaskRun).toHaveBeenCalledTimes(3);
    const cappedAudit = (
      mocks.nestChat.recordHedgehogMessage as ReturnType<typeof vi.fn>
    ).mock.calls
      .map(([args]) => args)
      .find((m) =>
        typeof m.body === "string" ? m.body.includes("per-tick cap") : false,
      );
    expect(cappedAudit).toBeDefined();
  });

  it("refuses to raise a hoglet whose latest run is in_progress", async () => {
    const mocks = setupMocks({
      hoglets: [makeHoglet({ id: "h1", taskId: "task-1" })],
      hogletStates: {
        "task-1": { status: "in_progress", runId: "r1" },
      },
      promptResponse: makePromptWithToolsResponse([
        { id: "t-1", name: "raise_hoglet", input: { hoglet_id: "h1" } },
      ]),
    });
    const service = buildService(mocks);
    await service.tick("nest-1", "test");
    expect(mocks.cloudTasks.createTaskRun).not.toHaveBeenCalled();
    const audits = (
      mocks.nestChat.recordHedgehogMessage as ReturnType<typeof vi.fn>
    ).mock.calls
      .map(([args]) => args)
      .filter((m) => m.kind === "audit");
    expect(audits.some((m) => m.body.includes("Skipped raising"))).toBe(true);
  });

  it("debounces a second enqueueTick within MIN_TICK_INTERVAL_MS", async () => {
    const mocks = setupMocks({
      promptResponse: makePromptWithToolsResponse([
        {
          id: "t-1",
          name: "write_audit_entry",
          input: { summary: "noop" },
        },
      ]),
    });
    const service = buildService(mocks);
    await service.enqueueTick("nest-1", "first");
    await service.enqueueTick("nest-1", "second");
    expect(mocks.llm.promptWithTools).toHaveBeenCalledTimes(1);
  });

  it("persists scratchpad between ticks", async () => {
    const mocks = setupMocks({
      promptResponse: makePromptWithToolsResponse([
        {
          id: "t-1",
          name: "write_audit_entry",
          input: { summary: "first tick" },
        },
      ]),
    });
    const service = buildService(mocks);
    await service.tick("nest-1", "first");
    const persisted = mocks.stateRepo.findByNestId("nest-1");
    expect(persisted?.serializedStateJson).toBeTruthy();
    const parsed = JSON.parse(persisted?.serializedStateJson ?? "{}") as {
      scratchpad?: unknown[];
    };
    expect(Array.isArray(parsed.scratchpad)).toBe(true);
    expect((parsed.scratchpad ?? []).length).toBeGreaterThan(0);
  });

  it("resets stuck ticking rows on start()", () => {
    const mocks = setupMocks({});
    mocks.stateRepo.upsert({ nestId: "nest-1", state: "ticking" });
    const service = buildService(mocks);
    service.start();
    const after = mocks.stateRepo.findByNestId("nest-1");
    expect(after?.state).toBe("idle");
    const idleEmits = mocks.emittedNestChanged.filter(
      (e) =>
        e.event.kind === "hedgehog_tick" &&
        (e.event.state.state as string) === "idle",
    );
    expect(idleEmits.length).toBeGreaterThan(0);
  });

  it("removes event listeners on stop()", () => {
    const mocks = setupMocks({});
    const service = buildService(mocks);

    service.start();
    service.stop();
    service.start();

    expect(mocks.nestService.on).toHaveBeenCalledTimes(2);
    expect(mocks.nestService.off).toHaveBeenCalledTimes(1);
    expect(mocks.hogletService.on).toHaveBeenCalledTimes(2);
    expect(mocks.hogletService.off).toHaveBeenCalledTimes(1);

    service.stop();
  });

  it("aborts an in-flight tick when stopped", async () => {
    const mocks = setupMocks({});
    let capturedSignal: AbortSignal | undefined;
    (mocks.llm.promptWithTools as ReturnType<typeof vi.fn>).mockImplementation(
      async (_messages, options: { signal?: AbortSignal }) => {
        capturedSignal = options.signal;
        return await new Promise<PromptWithToolsOutput>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      },
    );
    const service = buildService(mocks);

    service.start();
    const tickPromise = service.enqueueTick("nest-1", "manual");
    await vi.waitFor(() => {
      expect(mocks.llm.promptWithTools).toHaveBeenCalledTimes(1);
    });
    service.stop();
    await tickPromise;

    expect(capturedSignal?.aborted).toBe(true);
    expect(mocks.stateRepo.findByNestId("nest-1")?.state).toBe("idle");
  });

  it("heartbeats due nests in parallel", async () => {
    const mocks = setupMocks({
      nests: [makeNest({ id: "nest-a" }), makeNest({ id: "nest-b" })],
    });
    const resolvers: Array<() => void> = [];
    (mocks.llm.promptWithTools as ReturnType<typeof vi.fn>).mockImplementation(
      async () =>
        await new Promise<PromptWithToolsOutput>((resolve) => {
          resolvers.push(() => resolve(makePromptWithToolsResponse([])));
        }),
    );
    const service = buildService(mocks);
    const runHeartbeat = (
      service as unknown as { runHeartbeat: () => Promise<void> }
    ).runHeartbeat.bind(service);

    const heartbeatPromise = runHeartbeat();
    await vi.waitFor(() => {
      expect(mocks.llm.promptWithTools).toHaveBeenCalledTimes(2);
    });
    for (const resolve of resolvers) resolve();
    await heartbeatPromise;
  });

  it("prunes debounce entries for inactive nests during heartbeat", async () => {
    const mocks = setupMocks({ nests: [makeNest({ id: "active-nest" })] });
    const service = buildService(mocks);
    const internals = service as unknown as {
      lastEnqueuedAt: Map<string, number>;
      runHeartbeat: () => Promise<void>;
    };
    internals.lastEnqueuedAt.set("inactive-nest", Date.now());

    await internals.runHeartbeat.call(service);

    expect(internals.lastEnqueuedAt.has("inactive-nest")).toBe(false);
    expect(internals.lastEnqueuedAt.has("active-nest")).toBe(true);
  });

  it("dispatches spawn_hoglet and calls hogletService.spawnInNest", async () => {
    const mocks = setupMocks({
      availableRepositories: [
        makeRepository({
          remoteUrl: "https://github.com/posthog/posthog.git",
        }),
      ],
      promptResponse: makePromptWithToolsResponse([
        {
          id: "t-1",
          name: "spawn_hoglet",
          input: {
            prompt: "Build the checkout page",
            repository: "posthog/posthog",
          },
        },
      ]),
    });
    const service = buildService(mocks);
    await service.tick("nest-1", "test");

    expect(mocks.hogletService.spawnInNest).toHaveBeenCalledWith(
      {
        nestId: "nest-1",
        prompt: "Build the checkout page",
        repository: "posthog/posthog",
      },
      expect.objectContaining({}),
    );
    const audits = (
      mocks.nestChat.recordHedgehogMessage as ReturnType<typeof vi.fn>
    ).mock.calls
      .map(([args]) => args)
      .filter((m) => m.kind === "audit");
    expect(audits.some((m) => m.body.includes("Spawned hoglet"))).toBe(true);
  });

  it("caps spawn_hoglet calls at 3 per tick", async () => {
    const mocks = setupMocks({
      nest: makeNest({ primaryRepository: "posthog/posthog" }),
      availableRepositories: [
        makeRepository({
          remoteUrl: "https://github.com/posthog/posthog.git",
        }),
      ],
      promptResponse: makePromptWithToolsResponse([
        { id: "t-1", name: "spawn_hoglet", input: { prompt: "work 1" } },
        { id: "t-2", name: "spawn_hoglet", input: { prompt: "work 2" } },
        { id: "t-3", name: "spawn_hoglet", input: { prompt: "work 3" } },
        { id: "t-4", name: "spawn_hoglet", input: { prompt: "work 4" } },
      ]),
    });
    const service = buildService(mocks);
    await service.tick("nest-1", "test");

    expect(mocks.hogletService.spawnInNest).toHaveBeenCalledTimes(3);
    const cappedAudit = (
      mocks.nestChat.recordHedgehogMessage as ReturnType<typeof vi.fn>
    ).mock.calls
      .map(([args]) => args)
      .find((m) =>
        typeof m.body === "string" ? m.body.includes("per-tick cap") : false,
      );
    expect(cappedAudit).toBeDefined();
  });

  it("counts failed spawns toward the per-tick cap", async () => {
    const mocks = setupMocks({
      nest: makeNest({ primaryRepository: "posthog/posthog" }),
      availableRepositories: [
        makeRepository({
          remoteUrl: "https://github.com/posthog/posthog.git",
        }),
      ],
      promptResponse: makePromptWithToolsResponse([
        { id: "t-1", name: "spawn_hoglet", input: { prompt: "work 1" } },
        { id: "t-2", name: "spawn_hoglet", input: { prompt: "work 2" } },
        { id: "t-3", name: "spawn_hoglet", input: { prompt: "work 3" } },
        { id: "t-4", name: "spawn_hoglet", input: { prompt: "work 4" } },
      ]),
    });
    (
      mocks.hogletService.spawnInNest as ReturnType<typeof vi.fn>
    ).mockRejectedValue(new Error("cloud_unavailable"));
    const service = buildService(mocks);
    await service.tick("nest-1", "test");

    expect(mocks.hogletService.spawnInNest).toHaveBeenCalledTimes(3);
  });

  it("passes loadout model and runtimeAdapter when raising hoglets", async () => {
    const idleHoglets = [makeHoglet({ id: "h1", taskId: "task-1" })];
    const mocks = setupMocks({
      nest: makeNest({
        loadoutJson: JSON.stringify({
          model: defaultModelForAdapter("codex"),
          runtimeAdapter: "codex",
          reasoningEffort: "high",
          executionMode: "full-access",
          environment: "local",
        }),
      }),
      hoglets: idleHoglets,
      hogletStates: {
        "task-1": { status: "completed", runId: "run-old" },
      },
      promptResponse: makePromptWithToolsResponse([
        {
          id: "t-1",
          name: "raise_hoglet",
          input: { hoglet_id: "h1", prompt: "go" },
        },
      ]),
    });
    const service = buildService(mocks);
    await service.tick("nest-1", "test");

    expect(mocks.cloudTasks.createTaskRun).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        model: defaultModelForAdapter("codex"),
        runtimeAdapter: "codex",
        reasoningEffort: "high",
        initialPermissionMode: "full-access",
        environment: "local",
        prAuthorshipMode: "bot",
      }),
    );
  });

  it("defaults to codex model when adapter is codex and no model is set", async () => {
    const idleHoglets = [makeHoglet({ id: "h1", taskId: "task-1" })];
    const mocks = setupMocks({
      nest: makeNest({
        loadoutJson: JSON.stringify({ runtimeAdapter: "codex" }),
      }),
      hoglets: idleHoglets,
      hogletStates: {
        "task-1": { status: "completed", runId: "run-old" },
      },
      promptResponse: makePromptWithToolsResponse([
        {
          id: "t-1",
          name: "raise_hoglet",
          input: { hoglet_id: "h1", prompt: "go" },
        },
      ]),
    });
    const service = buildService(mocks);
    await service.tick("nest-1", "test");

    expect(mocks.cloudTasks.createTaskRun).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        model: defaultModelForAdapter("codex"),
        runtimeAdapter: "codex",
        reasoningEffort: DEFAULT_CODEX_REASONING_EFFORT,
        initialPermissionMode: "full-access",
      }),
    );
  });

  it("uses user task preferences when the nest has no explicit loadout", async () => {
    (readUserTaskPreferences as ReturnType<typeof vi.fn>).mockReturnValue({
      runtimeAdapter: "codex",
      reasoningEffort: "medium",
    });
    const idleHoglets = [makeHoglet({ id: "h1", taskId: "task-1" })];
    const mocks = setupMocks({
      hoglets: idleHoglets,
      hogletStates: {
        "task-1": { status: "completed", runId: "run-old" },
      },
      promptResponse: makePromptWithToolsResponse([
        {
          id: "t-1",
          name: "raise_hoglet",
          input: { hoglet_id: "h1", prompt: "go" },
        },
      ]),
    });
    const service = buildService(mocks);
    await service.tick("nest-1", "test");

    expect(mocks.cloudTasks.createTaskRun).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        model: defaultModelForAdapter("codex"),
        runtimeAdapter: "codex",
        reasoningEffort: "medium",
        initialPermissionMode: "full-access",
      }),
    );
  });

  it("passes loadout to spawnInNest when spawning hoglets", async () => {
    const mocks = setupMocks({
      nest: makeNest({
        primaryRepository: "posthog/posthog",
        loadoutJson: JSON.stringify({
          model: defaultModelForAdapter("codex"),
          runtimeAdapter: "codex",
          reasoningEffort: DEFAULT_CODEX_REASONING_EFFORT,
          executionMode: "full-access",
        }),
      }),
      availableRepositories: [
        makeRepository({
          remoteUrl: "https://github.com/posthog/posthog.git",
        }),
      ],
      promptResponse: makePromptWithToolsResponse([
        { id: "t-1", name: "spawn_hoglet", input: { prompt: "work" } },
      ]),
    });
    const service = buildService(mocks);
    await service.tick("nest-1", "test");

    expect(mocks.hogletService.spawnInNest).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "work" }),
      expect.objectContaining({
        model: defaultModelForAdapter("codex"),
        runtimeAdapter: "codex",
        reasoningEffort: DEFAULT_CODEX_REASONING_EFFORT,
        executionMode: "full-access",
      }),
    );
  });

  it("defaults spawned hoglets to the nest primary repository", async () => {
    const mocks = setupMocks({
      nest: makeNest({ primaryRepository: "Brooker-Fam/nexus-game" }),
      availableRepositories: [
        makeRepository({
          remoteUrl: "https://github.com/Brooker-Fam/nexus-game.git",
        }),
      ],
      recentChat: [
        makeMessage({
          kind: "user_message",
          payloadJson: JSON.stringify({
            creationBootstrap: {
              repositories: ["Brooker-Fam/nexus-game"],
              primaryRepository: "Brooker-Fam/nexus-game",
            },
          }),
        }),
      ],
      promptResponse: makePromptWithToolsResponse([
        { id: "t-1", name: "spawn_hoglet", input: { prompt: "work" } },
      ]),
    });
    const service = buildService(mocks);
    await service.tick("nest-1", "test");

    expect(mocks.hogletService.spawnInNest).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "work",
        repository: "Brooker-Fam/nexus-game",
      }),
      expect.any(Object),
    );
    const prompt = (mocks.llm.promptWithTools as ReturnType<typeof vi.fn>).mock
      .calls[0][0][0].content;
    expect(prompt).toContain("primary_repository: Brooker-Fam/nexus-game");
  });

  it("falls back to the sole locally-configured repo when nest has none", async () => {
    const mocks = setupMocks({
      nest: makeNest({ primaryRepository: null }),
      availableRepositories: [
        makeRepository({
          remoteUrl: "https://github.com/posthog/posthog.git",
        }),
      ],
      promptResponse: makePromptWithToolsResponse([
        { id: "t-1", name: "spawn_hoglet", input: { prompt: "work" } },
      ]),
    });
    const service = buildService(mocks);
    await service.tick("nest-1", "test");

    expect(mocks.hogletService.spawnInNest).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "work",
        repository: "posthog/posthog",
      }),
      expect.any(Object),
    );
  });

  it("refuses spawn_hoglet when no repository can be resolved", async () => {
    const mocks = setupMocks({
      nest: makeNest({ primaryRepository: null }),
      availableRepositories: [
        makeRepository({ remoteUrl: "https://github.com/posthog/posthog.git" }),
        makeRepository({
          remoteUrl: "https://github.com/posthog/posthog-js.git",
        }),
      ],
      promptResponse: makePromptWithToolsResponse([
        { id: "t-1", name: "spawn_hoglet", input: { prompt: "work" } },
      ]),
    });
    const service = buildService(mocks);
    await service.tick("nest-1", "test");

    expect(mocks.hogletService.spawnInNest).not.toHaveBeenCalled();
    const audits = (
      mocks.nestChat.recordHedgehogMessage as ReturnType<typeof vi.fn>
    ).mock.calls
      .map(([args]) => args)
      .filter((m) => m.kind === "audit");
    expect(
      audits.some(
        (m) =>
          typeof m.body === "string" && m.body.includes("Refused spawn_hoglet"),
      ),
    ).toBe(true);
  });

  it("surfaces known_repositories from the repository repo in the user prompt", async () => {
    const mocks = setupMocks({
      nest: makeNest({ primaryRepository: null }),
      availableRepositories: [
        makeRepository({ remoteUrl: "https://github.com/posthog/posthog.git" }),
        makeRepository({ remoteUrl: "git@github.com:posthog/posthog-js.git" }),
        makeRepository({ remoteUrl: null }),
      ],
      promptResponse: makePromptWithToolsResponse([
        { id: "t-1", name: "write_audit_entry", input: { summary: "noop" } },
      ]),
    });
    const service = buildService(mocks);
    await service.tick("nest-1", "test");

    const prompt = (mocks.llm.promptWithTools as ReturnType<typeof vi.fn>).mock
      .calls[0][0][0].content;
    expect(prompt).toContain(
      "known_repositories: posthog/posthog, posthog/posthog-js",
    );
  });

  it("writes an error audit when spawn_hoglet fails", async () => {
    const mocks = setupMocks({
      nest: makeNest({ primaryRepository: "posthog/posthog" }),
      availableRepositories: [
        makeRepository({
          remoteUrl: "https://github.com/posthog/posthog.git",
        }),
      ],
      promptResponse: makePromptWithToolsResponse([
        { id: "t-1", name: "spawn_hoglet", input: { prompt: "work" } },
      ]),
    });
    (
      mocks.hogletService.spawnInNest as ReturnType<typeof vi.fn>
    ).mockRejectedValue(new Error("nest_hoglet_cap_reached"));
    const service = buildService(mocks);
    await service.tick("nest-1", "test");

    const audits = (
      mocks.nestChat.recordHedgehogMessage as ReturnType<typeof vi.fn>
    ).mock.calls
      .map(([args]) => args)
      .filter((m) => m.kind === "audit");
    expect(audits.some((m) => m.body.includes("Failed to spawn"))).toBe(true);
  });

  it("message_hoglet emits an InjectPrompt event via feedbackRouting", async () => {
    const hoglet = makeHoglet({ id: "h1", taskId: "task-1" });
    const mocks = setupMocks({
      hoglets: [hoglet],
      hogletStates: {
        "task-1": { status: "in_progress", runId: "run-1" },
      },
      promptResponse: makePromptWithToolsResponse([
        {
          id: "t-1",
          name: "message_hoglet",
          input: {
            hoglet_id: "h1",
            prompt: "Add error handling to the parser",
          },
        },
      ]),
    });
    const service = buildService(mocks);
    await service.tick("nest-1", "test");

    expect(mocks.feedbackRouting.routeHedgehogPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        hogletId: "h1",
        nestId: "nest-1",
        prompt: "Add error handling to the parser",
        toolCallId: "t-1",
      }),
    );

    const audits = (
      mocks.nestChat.recordHedgehogMessage as ReturnType<typeof vi.fn>
    ).mock.calls
      .map(([args]) => args)
      .filter((m) => m.kind === "audit");
    expect(audits.some((m) => m.body.includes("Messaged hoglet h1"))).toBe(
      true,
    );
  });

  it("counts failed raises toward the per-tick cap", async () => {
    const idleHoglets = [
      makeHoglet({ id: "h1", taskId: "task-1" }),
      makeHoglet({ id: "h2", taskId: "task-2" }),
      makeHoglet({ id: "h3", taskId: "task-3" }),
      makeHoglet({ id: "h4", taskId: "task-4" }),
    ];
    const mocks = setupMocks({
      hoglets: idleHoglets,
      hogletStates: {
        "task-1": { status: "completed", runId: "r1" },
        "task-2": { status: "completed", runId: "r2" },
        "task-3": { status: "completed", runId: "r3" },
        "task-4": { status: "completed", runId: "r4" },
      },
      promptResponse: makePromptWithToolsResponse([
        { id: "t-1", name: "raise_hoglet", input: { hoglet_id: "h1" } },
        { id: "t-2", name: "raise_hoglet", input: { hoglet_id: "h2" } },
        { id: "t-3", name: "raise_hoglet", input: { hoglet_id: "h3" } },
        { id: "t-4", name: "raise_hoglet", input: { hoglet_id: "h4" } },
      ]),
    });
    (
      mocks.cloudTasks.createTaskRun as ReturnType<typeof vi.fn>
    ).mockRejectedValue(new Error("cloud_unavailable"));
    const service = buildService(mocks);
    await service.tick("nest-1", "test");

    expect(mocks.cloudTasks.createTaskRun).toHaveBeenCalledTimes(3);
  });

  it("clamps codex reasoning effort to high when loadout specifies max", async () => {
    const idleHoglets = [makeHoglet({ id: "h1", taskId: "task-1" })];
    const mocks = setupMocks({
      nest: makeNest({
        loadoutJson: JSON.stringify({
          runtimeAdapter: "codex",
          reasoningEffort: "max",
        }),
      }),
      hoglets: idleHoglets,
      hogletStates: {
        "task-1": { status: "completed", runId: "run-old" },
      },
      promptResponse: makePromptWithToolsResponse([
        {
          id: "t-1",
          name: "raise_hoglet",
          input: { hoglet_id: "h1", prompt: "go" },
        },
      ]),
    });
    const service = buildService(mocks);
    await service.tick("nest-1", "test");

    expect(mocks.cloudTasks.createTaskRun).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        runtimeAdapter: "codex",
        reasoningEffort: "high",
      }),
    );
  });

  it("dispatches link_pr_dependency, validating both task_ids belong to the nest", async () => {
    const mocks = setupMocks({
      hoglets: [
        makeHoglet({ id: "h1", taskId: "task-parent" }),
        makeHoglet({ id: "h2", taskId: "task-child" }),
      ],
      hogletStates: {
        "task-parent": { status: "completed", runId: "r1" },
        "task-child": { status: "in_progress", runId: "r2" },
      },
      promptResponse: makePromptWithToolsResponse([
        {
          id: "t-1",
          name: "link_pr_dependency",
          input: {
            parent_task_id: "task-parent",
            child_task_id: "task-child",
            reason: "child branched off parent",
          },
        },
      ]),
    });

    const service = buildService(mocks);
    await service.tick("nest-1", "test");

    expect(mocks.prGraph.link).toHaveBeenCalledWith({
      nestId: "nest-1",
      parentTaskId: "task-parent",
      childTaskId: "task-child",
    });
    const audits = (
      mocks.nestChat.recordHedgehogMessage as ReturnType<typeof vi.fn>
    ).mock.calls
      .map(([args]) => args)
      .filter((m) => m.kind === "audit");
    expect(audits.some((m) => m.body.startsWith("Linked PR dependency"))).toBe(
      true,
    );
  });

  it("rejects link_pr_dependency when a task is not in the nest", async () => {
    const mocks = setupMocks({
      hoglets: [makeHoglet({ id: "h1", taskId: "task-parent" })],
      hogletStates: {
        "task-parent": { status: "completed", runId: "r1" },
      },
      promptResponse: makePromptWithToolsResponse([
        {
          id: "t-1",
          name: "link_pr_dependency",
          input: {
            parent_task_id: "task-parent",
            child_task_id: "task-not-in-nest",
            reason: "stacked",
          },
        },
      ]),
    });

    const service = buildService(mocks);
    await service.tick("nest-1", "test");

    expect(mocks.prGraph.link).not.toHaveBeenCalled();
    const audits = (
      mocks.nestChat.recordHedgehogMessage as ReturnType<typeof vi.fn>
    ).mock.calls
      .map(([args]) => args)
      .filter((m) => m.kind === "audit");
    expect(
      audits.some(
        (m) =>
          typeof m.body === "string" && m.body.includes("link_pr_dependency"),
      ),
    ).toBe(true);
  });

  it("dispatches unlink_pr_dependency only for edges in the nest", async () => {
    const mocks = setupMocks({
      hoglets: [
        makeHoglet({ id: "h1", taskId: "task-parent" }),
        makeHoglet({ id: "h2", taskId: "task-child" }),
      ],
      prDependencies: [
        {
          nestId: "nest-1",
          parentTaskId: "task-parent",
          childTaskId: "task-child",
          state: "pending",
        },
      ],
    });
    const edgeId = mocks.prDependencies.listForNest("nest-1")[0].id;
    mocks.llm.promptWithTools = vi.fn(async () =>
      makePromptWithToolsResponse([
        {
          id: "t-1",
          name: "unlink_pr_dependency",
          input: { edge_id: edgeId, reason: "not stacked anymore" },
        },
      ]),
    ) as never;

    const service = buildService(mocks);
    await service.tick("nest-1", "test");

    expect(mocks.prGraph.unlink).toHaveBeenCalledWith({ id: edgeId });
  });

  it("dispatches rebase_child by calling requestRebase on the service", async () => {
    const mocks = setupMocks({
      hoglets: [
        makeHoglet({ id: "h1", taskId: "task-parent" }),
        makeHoglet({ id: "h2", taskId: "task-child" }),
      ],
      prDependencies: [
        {
          nestId: "nest-1",
          parentTaskId: "task-parent",
          childTaskId: "task-child",
          state: "pending",
        },
      ],
    });
    const edgeId = mocks.prDependencies.listForNest("nest-1")[0].id;
    mocks.llm.promptWithTools = vi.fn(async () =>
      makePromptWithToolsResponse([
        {
          id: "t-1",
          name: "rebase_child",
          input: { edge_id: edgeId, prompt: "rebase now please" },
        },
      ]),
    ) as never;

    const service = buildService(mocks);
    await service.tick("nest-1", "test");

    expect(mocks.prGraph.requestRebase).toHaveBeenCalledWith({
      edgeId,
      promptOverride: "rebase now please",
    });
    const audits = (
      mocks.nestChat.recordHedgehogMessage as ReturnType<typeof vi.fn>
    ).mock.calls
      .map(([args]) => args)
      .filter((m) => m.kind === "audit");
    expect(audits.some((m) => m.body.startsWith("Requested rebase"))).toBe(
      true,
    );
  });
});

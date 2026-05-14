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

import type { HedgehogStateRepository } from "../../db/repositories/hedgehog-state-repository";
import { createMockHedgehogStateRepository } from "../../db/repositories/hedgehog-state-repository.mock";
import type {
  AnthropicToolUseBlock,
  PromptWithToolsOutput,
} from "../llm-gateway/schemas";
import type { LlmGatewayService } from "../llm-gateway/service";
import type { CloudTaskClient } from "./cloud-task-client";
import { HedgehogTickService } from "./hedgehog-tick-service";
import type { HogletService } from "./hoglet-service";
import type { NestChatService } from "./nest-chat-service";
import type { NestService } from "./nest-service";
import {
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
  emittedNestChanged: HedgemonyEvents["nest-changed"][];
}

function setupMocks(input: {
  nest?: Nest;
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
    }
  >;
  promptResponse?: PromptWithToolsOutput;
  promptThrows?: Error;
}): Mocks {
  const nest = input.nest ?? makeNest();
  const hoglets = input.hoglets ?? [];
  const hogletStates = input.hogletStates ?? {};

  const emittedNestChanged: HedgemonyEvents["nest-changed"][] = [];
  const listeners = new Map<string, AnyListener[]>();

  const nestService = {
    list: vi.fn(() => [nest]),
    get: vi.fn(({ id }: { id: string }) => {
      if (id === nest.id) return nest;
      throw new Error(`Nest not found: ${id}`);
    }),
    on: vi.fn((event: string, listener: AnyListener) => {
      const arr = listeners.get(event) ?? [];
      arr.push(listener);
      listeners.set(event, arr);
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
  } as unknown as HogletService;

  const nestChat = {
    list: vi.fn(() => []),
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
        task: { id: taskId, latest_run: undefined } as never,
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
  } as unknown as CloudTaskClient;

  const llm = {
    promptWithTools: vi.fn(async () => {
      if (input.promptThrows) throw input.promptThrows;
      return input.promptResponse ?? makePromptWithToolsResponse([]);
    }),
  } as unknown as LlmGatewayService;

  const stateRepo =
    createMockHedgehogStateRepository() as unknown as HedgehogStateRepository;

  return {
    llm,
    nestService,
    hogletService,
    nestChat,
    cloudTasks,
    stateRepo,
    emittedNestChanged,
  };
}

function buildService(mocks: Mocks): HedgehogTickService {
  return new HedgehogTickService(
    mocks.llm,
    mocks.nestService,
    mocks.hogletService,
    mocks.nestChat,
    mocks.stateRepo,
    mocks.cloudTasks,
  );
}

describe("HedgehogTickService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    // First emit is ticking, last is idle.
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
});

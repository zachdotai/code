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
import type { GitService } from "../git/service";
import type { CloudTaskClient } from "./cloud-task-client";
import type { NestChatService } from "./nest-chat-service";
import type { NestService } from "./nest-service";
import { PrGraphService, PrGraphServiceEvent } from "./pr-graph-service";
import type { Hoglet, RebaseChildEventPayload } from "./schemas";

function makeHoglet(overrides: Partial<Hoglet> = {}): Hoglet {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name ?? null,
    taskId: overrides.taskId ?? "task-child",
    nestId: overrides.nestId ?? "nest-1",
    signalReportId: overrides.signalReportId ?? null,
    affinityScore: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  };
}

function createMockHogletRepository(hoglets: Hoglet[]): HogletRepository {
  return {
    findByTaskId: vi.fn(
      (taskId: string) => hoglets.find((h) => h.taskId === taskId) ?? null,
    ),
  } as unknown as HogletRepository;
}

function createMockNestChatService(): NestChatService {
  return {
    recordHedgehogMessage: vi.fn((input) => ({
      id: crypto.randomUUID(),
      nestId: input.nestId,
      kind: input.kind,
      visibility: input.visibility ?? "summary",
      sourceTaskId: input.sourceTaskId ?? null,
      body: input.body,
      payloadJson: input.payloadJson ? JSON.stringify(input.payloadJson) : null,
      createdAt: new Date().toISOString(),
    })),
  } as unknown as NestChatService;
}

function createMockNestService(): NestService {
  return {
    emitMessageAppended: vi.fn(),
  } as unknown as NestService;
}

function createMockGitService(
  prDetails: { state: string; merged: boolean; draft: boolean } | null,
): GitService {
  return {
    getPrDetailsByUrl: vi.fn(async () => prDetails),
  } as unknown as GitService;
}

function createMockCloudTaskClient(opts: {
  prUrl?: string | null;
  branch?: string | null;
}): CloudTaskClient {
  const { prUrl = null, branch = null } = opts;
  return {
    getTaskWithLatestRun: vi.fn(async (taskId: string) => ({
      task: {
        id: taskId,
        latest_run: prUrl
          ? {
              id: "run-1",
              status: "completed",
              branch,
              output: { pr_url: prUrl },
            }
          : null,
      },
      latestRun: null,
    })),
  } as unknown as CloudTaskClient;
}

function buildService(opts: {
  edges?: Array<{
    nestId: string;
    parentTaskId: string;
    childTaskId: string;
    state: "pending" | "satisfied" | "broken" | "follow_up";
  }>;
  hoglets?: Hoglet[];
  prUrl?: string | null;
  branch?: string | null;
  prDetails?: { state: string; merged: boolean; draft: boolean } | null;
}) {
  const prDeps = createMockPrDependencyRepository();
  for (const e of opts.edges ?? []) {
    prDeps.insert(e);
  }
  const hoglets = createMockHogletRepository(opts.hoglets ?? []);
  const cloudTasks = createMockCloudTaskClient({
    prUrl: opts.prUrl ?? null,
    branch: opts.branch ?? null,
  });
  const git = createMockGitService(opts.prDetails ?? null);
  const nests = createMockNestService();
  const nestChat = createMockNestChatService();
  const service = new PrGraphService(
    prDeps as unknown as PrDependencyRepository,
    hoglets,
    cloudTasks,
    git,
    nests,
    nestChat,
  );
  return { service, prDeps, hoglets, cloudTasks, git, nests, nestChat };
}

describe("PrGraphService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits a rebaseChild event when the parent PR is merged", async () => {
    const child = makeHoglet({ taskId: "task-child", nestId: "nest-1" });
    const { service } = buildService({
      edges: [
        {
          nestId: "nest-1",
          parentTaskId: "task-parent",
          childTaskId: "task-child",
          state: "pending",
        },
      ],
      hoglets: [child],
      prUrl: "https://github.com/org/repo/pull/1",
      branch: "feature/parent",
      prDetails: { state: "closed", merged: true, draft: false },
    });

    const received: RebaseChildEventPayload[] = [];
    service.on(PrGraphServiceEvent.RebaseChild, (payload) => {
      received.push(payload);
    });

    await service.runPoll();

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      nestId: "nest-1",
      parentTaskId: "task-parent",
      childTaskId: "task-child",
      childHogletId: child.id,
      parentPrUrl: "https://github.com/org/repo/pull/1",
      parentBranch: "feature/parent",
    });
    expect(received[0].prompt).toContain("feature/parent");
    expect(received[0].fallbackPrompt).toContain("feature/parent");
  });

  it("does not emit when the parent PR is still open", async () => {
    const child = makeHoglet({ taskId: "task-child", nestId: "nest-1" });
    const { service } = buildService({
      edges: [
        {
          nestId: "nest-1",
          parentTaskId: "task-parent",
          childTaskId: "task-child",
          state: "pending",
        },
      ],
      hoglets: [child],
      prUrl: "https://github.com/org/repo/pull/1",
      prDetails: { state: "open", merged: false, draft: false },
    });

    const received: RebaseChildEventPayload[] = [];
    service.on(PrGraphServiceEvent.RebaseChild, (payload) => {
      received.push(payload);
    });

    await service.runPoll();

    expect(received).toHaveLength(0);
  });

  it("debounces per-parent polls so two ticks in quick succession only fire once", async () => {
    const child = makeHoglet({ taskId: "task-child", nestId: "nest-1" });
    const { service, cloudTasks } = buildService({
      edges: [
        {
          nestId: "nest-1",
          parentTaskId: "task-parent",
          childTaskId: "task-child",
          state: "pending",
        },
      ],
      hoglets: [child],
      prUrl: "https://github.com/org/repo/pull/1",
      prDetails: { state: "open", merged: false, draft: false },
    });

    await service.runPoll();
    await service.runPoll();

    expect(cloudTasks.getTaskWithLatestRun).toHaveBeenCalledTimes(1);
  });

  it("does not emit duplicate rebase events after the parent debounce window", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      vi.setSystemTime(new Date("2026-05-13T00:00:00.000Z"));
      const child = makeHoglet({ taskId: "task-child", nestId: "nest-1" });
      const { service } = buildService({
        edges: [
          {
            nestId: "nest-1",
            parentTaskId: "task-parent",
            childTaskId: "task-child",
            state: "pending",
          },
        ],
        hoglets: [child],
        prUrl: "https://github.com/org/repo/pull/1",
        branch: "feature/parent",
        prDetails: { state: "closed", merged: true, draft: false },
      });

      const received: RebaseChildEventPayload[] = [];
      service.on(PrGraphServiceEvent.RebaseChild, (payload) => {
        received.push(payload);
      });

      await service.runPoll();
      vi.setSystemTime(new Date("2026-05-13T00:01:00.000Z"));
      await service.runPoll();

      expect(received).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("queues rebase events when no listener is attached and drains via consumePending", async () => {
    const child = makeHoglet({ taskId: "task-child", nestId: "nest-1" });
    const { service } = buildService({
      edges: [
        {
          nestId: "nest-1",
          parentTaskId: "task-parent",
          childTaskId: "task-child",
          state: "pending",
        },
      ],
      hoglets: [child],
      prUrl: "https://github.com/org/repo/pull/1",
      branch: "feature/parent",
      prDetails: { state: "closed", merged: true, draft: false },
    });

    await service.runPoll();

    const drained = service.consumePending();
    expect(drained).toHaveLength(1);
    expect(service.consumePending()).toHaveLength(0);
  });

  it("link is idempotent — two link calls on the same triple produce one row", () => {
    const { service, prDeps } = buildService({});
    const first = service.link({
      nestId: "nest-1",
      parentTaskId: "task-parent",
      childTaskId: "task-child",
    });
    const second = service.link({
      nestId: "nest-1",
      parentTaskId: "task-parent",
      childTaskId: "task-child",
    });
    expect(first.id).toBe(second.id);
    expect(prDeps._rows).toHaveLength(1);
  });

  it("recordRebaseOutcome transitions injected → satisfied and writes an audit row", () => {
    const { service, prDeps, nestChat, nests } = buildService({
      edges: [
        {
          nestId: "nest-1",
          parentTaskId: "task-parent",
          childTaskId: "task-child",
          state: "pending",
        },
      ],
    });
    const edge = prDeps._rows[0];
    const updated = service.recordRebaseOutcome({
      edgeId: edge.id,
      outcome: "injected",
    });
    expect(updated.state).toBe("satisfied");
    expect(nestChat.recordHedgehogMessage).toHaveBeenCalledTimes(1);
    expect(nests.emitMessageAppended).toHaveBeenCalledTimes(1);
  });

  it("recordRebaseOutcome maps follow_up_spawned to satisfied and broken to broken", () => {
    const { service, prDeps } = buildService({
      edges: [
        {
          nestId: "nest-1",
          parentTaskId: "task-parent",
          childTaskId: "task-child",
          state: "pending",
        },
        {
          nestId: "nest-1",
          parentTaskId: "task-parent-2",
          childTaskId: "task-child-2",
          state: "pending",
        },
      ],
    });
    expect(
      service.recordRebaseOutcome({
        edgeId: prDeps._rows[0].id,
        outcome: "follow_up_spawned",
      }).state,
    ).toBe("satisfied");
    expect(
      service.recordRebaseOutcome({
        edgeId: prDeps._rows[1].id,
        outcome: "broken",
        note: "no session",
      }).state,
    ).toBe("broken");
  });

  it("unlinkAllForTask removes incoming and outgoing edges for a task", () => {
    const { service, prDeps } = buildService({
      edges: [
        {
          nestId: "nest-1",
          parentTaskId: "task-a",
          childTaskId: "task-b",
          state: "pending",
        },
        {
          nestId: "nest-1",
          parentTaskId: "task-b",
          childTaskId: "task-c",
          state: "pending",
        },
        {
          nestId: "nest-1",
          parentTaskId: "task-x",
          childTaskId: "task-y",
          state: "pending",
        },
      ],
    });
    service.unlinkAllForTask("task-b");
    expect(
      prDeps._rows.map((r) => `${r.parentTaskId}->${r.childTaskId}`),
    ).toEqual(["task-x->task-y"]);
  });
});

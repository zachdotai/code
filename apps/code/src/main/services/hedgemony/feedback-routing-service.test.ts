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

import type { FeedbackEventRepository } from "../../db/repositories/feedback-event-repository";
import { createMockFeedbackEventRepository } from "../../db/repositories/feedback-event-repository.mock";
import type { GitService } from "../git/service";
import type { CloudTaskClient } from "./cloud-task-client";
import {
  FeedbackRoutingEvent,
  FeedbackRoutingService,
} from "./feedback-routing-service";
import type { HogletService } from "./hoglet-service";
import type { NestChatService } from "./nest-chat-service";
import type { NestService } from "./nest-service";
import type { Hoglet, InjectPromptEventPayload } from "./schemas";

function makeHoglet(overrides: Partial<Hoglet> = {}): Hoglet {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    taskId: overrides.taskId ?? "task-1",
    nestId: overrides.nestId ?? null,
    signalReportId: overrides.signalReportId ?? null,
    affinityScore: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  };
}

function createMockHogletService(hoglets: Hoglet[]): HogletService {
  return {
    list: vi.fn(
      (input: {
        wildOnly?: boolean;
        signalStagingOnly?: boolean;
        nestId?: string;
      }) => {
        if (input.wildOnly) {
          return hoglets.filter(
            (h) => h.nestId === null && h.signalReportId === null,
          );
        }
        if (input.signalStagingOnly) {
          return hoglets.filter(
            (h) => h.nestId === null && h.signalReportId !== null,
          );
        }
        if (input.nestId) {
          return hoglets.filter((h) => h.nestId === input.nestId);
        }
        return [];
      },
    ),
  } as unknown as HogletService;
}

function createMockNestService(nestIds: string[] = ["nest-1"]): NestService {
  return {
    list: vi.fn(() =>
      nestIds.map((id) => ({
        id,
        name: id,
        goalPrompt: "",
        definitionOfDone: null,
        mapX: 0,
        mapY: 0,
        status: "active",
        health: "ok",
        targetMetricId: null,
        loadoutJson: null,
        createdAt: "",
        updatedAt: "",
      })),
    ),
    emitMessageAppended: vi.fn(),
  } as unknown as NestService;
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

function createMockGitService(opts: {
  reviewComments?: Array<Record<string, unknown>>;
  checkRuns?: Array<Record<string, unknown>>;
  prDetails?: { state: string; merged: boolean; draft: boolean } | null;
}): GitService {
  return {
    getPrDetailsByUrl: vi.fn(
      async () =>
        opts.prDetails ?? {
          state: "open",
          merged: false,
          draft: false,
        },
    ),
    getPrReviewComments: vi.fn(async () => opts.reviewComments ?? []),
    getPrCheckRuns: vi.fn(async () => opts.checkRuns ?? []),
  } as unknown as GitService;
}

function createMockCloudTaskClient(prUrl: string | null): CloudTaskClient {
  return {
    getTaskWithLatestRun: vi.fn(async (taskId: string) => ({
      task: {
        id: taskId,
        latest_run: prUrl ? { output: { pr_url: prUrl } } : null,
      },
      latestRun: null,
    })),
  } as unknown as CloudTaskClient;
}

describe("FeedbackRoutingService", () => {
  let feedbackRepo: ReturnType<typeof createMockFeedbackEventRepository>;
  let nestChat: NestChatService;
  let nests: NestService;

  beforeEach(() => {
    feedbackRepo = createMockFeedbackEventRepository();
    nestChat = createMockNestChatService();
    nests = createMockNestService();
  });

  it("emits an injectPrompt event for each new PR review comment", async () => {
    const hoglet = makeHoglet({ taskId: "task-1", nestId: "nest-1" });
    const hoglets = createMockHogletService([hoglet]);
    const git = createMockGitService({
      reviewComments: [
        {
          id: 1001,
          body: "fix the off-by-one",
          path: "src/foo.ts",
          line: 42,
          original_line: null,
          side: "RIGHT",
          start_line: null,
          start_side: null,
          diff_hunk: "",
          user: { login: "alice", avatar_url: "" },
          created_at: "",
          updated_at: "",
          subject_type: "line",
        },
      ],
      checkRuns: [],
    });
    const cloudTasks = createMockCloudTaskClient(
      "https://github.com/org/repo/pull/7",
    );

    const service = new FeedbackRoutingService(
      hoglets,
      nests,
      git,
      cloudTasks,
      feedbackRepo as unknown as FeedbackEventRepository,
      nestChat,
    );

    const received: InjectPromptEventPayload[] = [];
    service.on(FeedbackRoutingEvent.InjectPrompt, (e) => {
      received.push(e);
    });

    await service.runPoll();

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      taskId: "task-1",
      source: "pr_review",
      payloadRef: "pr-comment:1001",
      nestId: "nest-1",
      prUrl: "https://github.com/org/repo/pull/7",
    });
    expect(received[0].prompt).toContain("fix the off-by-one");
    expect(received[0].fallbackPrompt).toContain("alice");
  });

  it("does not re-emit for an already-recorded payload_hash", async () => {
    const hoglet = makeHoglet({ taskId: "task-1", nestId: "nest-1" });
    const hoglets = createMockHogletService([hoglet]);
    const git = createMockGitService({
      reviewComments: [
        {
          id: 1001,
          body: "fix the off-by-one",
          path: "src/foo.ts",
          line: 42,
          original_line: null,
          side: "RIGHT",
          start_line: null,
          start_side: null,
          diff_hunk: "",
          user: { login: "alice", avatar_url: "" },
          created_at: "",
          updated_at: "",
          subject_type: "line",
        },
      ],
    });
    const cloudTasks = createMockCloudTaskClient(
      "https://github.com/org/repo/pull/7",
    );
    const service = new FeedbackRoutingService(
      hoglets,
      nests,
      git,
      cloudTasks,
      feedbackRepo as unknown as FeedbackEventRepository,
      nestChat,
    );

    const received: InjectPromptEventPayload[] = [];
    service.on(FeedbackRoutingEvent.InjectPrompt, (e) => {
      received.push(e);
    });

    await service.runPoll();
    expect(received).toHaveLength(1);

    // Simulate the renderer recording the routing outcome.
    service.recordRoutedOutcome({
      nestId: received[0].nestId,
      hogletTaskId: received[0].taskId,
      source: received[0].source,
      payloadHash: received[0].payloadHash,
      payloadRef: received[0].payloadRef,
      routedOutcome: "injected",
    });

    // Reset the per-task debounce so the second poll runs.
    (
      service as unknown as {
        lastPolledAt: Map<string, number>;
      }
    ).lastPolledAt.clear();

    await service.runPoll();
    expect(received).toHaveLength(1);
  });

  it("emits CI failure events only for failing conclusions", async () => {
    const hoglet = makeHoglet({ taskId: "task-1", nestId: "nest-1" });
    const hoglets = createMockHogletService([hoglet]);
    const git = createMockGitService({
      reviewComments: [],
      checkRuns: [
        {
          id: 1,
          name: "tests",
          status: "completed",
          conclusion: "success",
          headSha: "abc",
          htmlUrl: "https://example.com/1",
          completedAt: "2026-05-13T00:00:00Z",
        },
        {
          id: 2,
          name: "lint",
          status: "completed",
          conclusion: "failure",
          headSha: "abc",
          htmlUrl: "https://example.com/2",
          completedAt: "2026-05-13T00:00:00Z",
        },
        {
          id: 3,
          name: "build",
          status: "in_progress",
          conclusion: null,
          headSha: "abc",
          htmlUrl: "https://example.com/3",
          completedAt: null,
        },
      ],
    });
    const cloudTasks = createMockCloudTaskClient(
      "https://github.com/org/repo/pull/7",
    );

    const service = new FeedbackRoutingService(
      hoglets,
      nests,
      git,
      cloudTasks,
      feedbackRepo as unknown as FeedbackEventRepository,
      nestChat,
    );

    const received: InjectPromptEventPayload[] = [];
    service.on(FeedbackRoutingEvent.InjectPrompt, (e) => {
      received.push(e);
    });

    await service.runPoll();

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      taskId: "task-1",
      source: "ci",
      payloadRef: "ci:2",
    });
    expect(received[0].prompt).toContain("lint");
  });

  it("queues events when there are no listeners, drained via consumePending", async () => {
    const hoglet = makeHoglet({ taskId: "task-1", nestId: "nest-1" });
    const hoglets = createMockHogletService([hoglet]);
    const git = createMockGitService({
      reviewComments: [
        {
          id: 1001,
          body: "comment",
          path: "src/foo.ts",
          line: 1,
          original_line: null,
          side: "RIGHT",
          start_line: null,
          start_side: null,
          diff_hunk: "",
          user: { login: "alice", avatar_url: "" },
          created_at: "",
          updated_at: "",
          subject_type: "line",
        },
      ],
    });
    const cloudTasks = createMockCloudTaskClient(
      "https://github.com/org/repo/pull/7",
    );

    const service = new FeedbackRoutingService(
      hoglets,
      nests,
      git,
      cloudTasks,
      feedbackRepo as unknown as FeedbackEventRepository,
      nestChat,
    );

    await service.runPoll();
    const drained = service.consumePending();
    expect(drained).toHaveLength(1);

    const drainedAgain = service.consumePending();
    expect(drainedAgain).toHaveLength(0);
  });

  it("isolates failures: one hoglet errors, others still poll", async () => {
    const hogletOk = makeHoglet({ taskId: "task-ok", nestId: "nest-1" });
    const hogletBad = makeHoglet({ taskId: "task-bad", nestId: "nest-1" });
    const hoglets = createMockHogletService([hogletOk, hogletBad]);
    const git = createMockGitService({
      reviewComments: [
        {
          id: 999,
          body: "comment",
          path: "src/foo.ts",
          line: 1,
          original_line: null,
          side: "RIGHT",
          start_line: null,
          start_side: null,
          diff_hunk: "",
          user: { login: "alice", avatar_url: "" },
          created_at: "",
          updated_at: "",
          subject_type: "line",
        },
      ],
    });
    const cloudTasks = {
      getTaskWithLatestRun: vi.fn(async (taskId: string) => {
        if (taskId === "task-bad") {
          throw new Error("boom");
        }
        return {
          task: {
            id: taskId,
            latest_run: {
              output: { pr_url: "https://github.com/org/repo/pull/7" },
            },
          },
          latestRun: null,
        };
      }),
    } as unknown as CloudTaskClient;

    const service = new FeedbackRoutingService(
      hoglets,
      nests,
      git,
      cloudTasks,
      feedbackRepo as unknown as FeedbackEventRepository,
      nestChat,
    );

    const received: InjectPromptEventPayload[] = [];
    service.on(FeedbackRoutingEvent.InjectPrompt, (e) => {
      received.push(e);
    });

    await service.runPoll();

    expect(received).toHaveLength(1);
    expect(received[0].taskId).toBe("task-ok");
  });

  it("recordRoutedOutcome writes a feedback event and a nest chat audit row", () => {
    const hoglets = createMockHogletService([]);
    const git = createMockGitService({});
    const cloudTasks = createMockCloudTaskClient(null);

    const service = new FeedbackRoutingService(
      hoglets,
      nests,
      git,
      cloudTasks,
      feedbackRepo as unknown as FeedbackEventRepository,
      nestChat,
    );

    const row = service.recordRoutedOutcome({
      nestId: "nest-1",
      hogletTaskId: "task-1",
      source: "pr_review",
      payloadHash: "hash-abc",
      payloadRef: "pr-comment:1",
      routedOutcome: "injected",
    });

    expect(row).toMatchObject({
      nestId: "nest-1",
      hogletTaskId: "task-1",
      source: "pr_review",
      payloadHash: "hash-abc",
      payloadRef: "pr-comment:1",
      routedOutcome: "injected",
      trustTier: "external",
    });
    expect(feedbackRepo._events).toHaveLength(1);
    expect(nestChat.recordHedgehogMessage).toHaveBeenCalledTimes(1);
    expect(nests.emitMessageAppended).toHaveBeenCalledTimes(1);
  });
});

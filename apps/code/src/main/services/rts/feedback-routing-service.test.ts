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
import type { Hoglet, InjectPromptEventPayload, NestMessage } from "./schemas";

function makeHoglet(overrides: Partial<Hoglet> = {}): Hoglet {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name ?? null,
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
    list: vi.fn((input: { wildOnly?: boolean; nestId?: string }) => {
      if (input.wildOnly) {
        return hoglets.filter((h) => h.nestId === null);
      }
      if (input.nestId) {
        return hoglets.filter((h) => h.nestId === input.nestId);
      }
      return [];
    }),
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
        primaryRepository: null,
        createdAt: "",
        updatedAt: "",
      })),
    ),
    emitMessageAppended: vi.fn(),
  } as unknown as NestService;
}

function createMockNestChatService(): NestChatService & {
  _messages: NestMessage[];
} {
  const messages: NestMessage[] = [];
  const service = {
    _messages: messages,
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
    list: vi.fn((input: { nestId: string; detail?: boolean }) =>
      messages.filter(
        (message) =>
          message.nestId === input.nestId &&
          (input.detail || message.visibility === "summary"),
      ),
    ),
    recordHogletSummary: vi.fn((input) => {
      const existing = messages.find((message) => {
        if (message.kind !== "hoglet_summary") return false;
        if (message.sourceTaskId !== input.taskId) return false;
        const payload = JSON.parse(message.payloadJson ?? "{}") as {
          runId?: unknown;
        };
        return payload.runId === input.runId;
      });
      if (existing) return { message: existing, created: false };

      const message: NestMessage = {
        id: crypto.randomUUID(),
        nestId: input.nestId,
        kind: "hoglet_summary",
        visibility: "summary",
        sourceTaskId: input.taskId,
        body: input.body,
        payloadJson: JSON.stringify({
          hogletId: input.hogletId,
          runId: input.runId,
          terminalReason: input.terminalReason,
        }),
        createdAt: new Date().toISOString(),
      };
      messages.push(message);
      return { message, created: true };
    }),
    recordHogletMessage: vi.fn((input) => {
      const existing = messages.find((message) => {
        if (message.kind !== "hoglet_message") return false;
        if (message.sourceTaskId !== input.taskId) return false;
        const payload = JSON.parse(message.payloadJson ?? "{}") as {
          runId?: unknown;
          turnIndex?: unknown;
        };
        return (
          payload.runId === input.runId && payload.turnIndex === input.turnIndex
        );
      });
      if (existing) return { message: existing, created: false };

      const message: NestMessage = {
        id: crypto.randomUUID(),
        nestId: input.nestId,
        kind: "hoglet_message",
        visibility: "summary",
        sourceTaskId: input.taskId,
        body: input.body,
        payloadJson: JSON.stringify({
          hogletId: input.hogletId,
          runId: input.runId,
          turnIndex: input.turnIndex,
          stopReason: input.stopReason,
        }),
        createdAt: new Date().toISOString(),
      };
      messages.push(message);
      return { message, created: true };
    }),
  };
  return service as unknown as NestChatService & { _messages: NestMessage[] };
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
    getTaskRunSessionLogs: vi.fn(async () => ({
      entries: [],
      hasMore: false,
    })),
    injectPrompt: vi.fn(async () => ({ accepted: true, processed: "unknown" })),
  } as unknown as CloudTaskClient;
}

function createMockCloudTaskClientWithNestedPrUrl(
  prUrl: string,
): CloudTaskClient {
  return {
    getTaskWithLatestRun: vi.fn(async (taskId: string) => ({
      task: {
        id: taskId,
        latest_run: { output: { output: { pr_url: prUrl } } },
      },
      latestRun: null,
    })),
    getTaskRunSessionLogs: vi.fn(async () => ({
      entries: [],
      hasMore: false,
    })),
  } as unknown as CloudTaskClient;
}

function createMockCloudTaskClientWithCompletedRun(
  output: Record<string, unknown>,
  sessionLogEntries: Array<
    | ReturnType<typeof storedAgentMessage>
    | ReturnType<typeof storedTurnComplete>
  > = [],
) {
  return {
    getTaskWithLatestRun: vi.fn(async (taskId: string) => {
      const latestRun = {
        id: "run-1",
        task: taskId,
        team: 1,
        branch: null,
        status: "completed",
        log_url: "",
        error_message: null,
        output,
        state: {},
        created_at: "2026-05-13T00:00:00Z",
        updated_at: "2026-05-13T00:10:00Z",
        completed_at: "2026-05-13T00:10:00Z",
      };
      return {
        task: {
          id: taskId,
          latest_run: latestRun,
        },
        latestRun,
      };
    }),
    getTaskRunSessionLogs: vi.fn(async () => ({
      entries: sessionLogEntries,
      hasMore: false,
    })),
  } as unknown as CloudTaskClient;
}

function createMockCloudTaskClientWithTerminalRun(input: {
  status: "failed" | "cancelled";
  errorMessage?: string | null;
}) {
  return {
    getTaskWithLatestRun: vi.fn(async (taskId: string) => {
      const latestRun = {
        id: "run-1",
        task: taskId,
        team: 1,
        branch: null,
        status: input.status,
        log_url: "",
        error_message: input.errorMessage ?? null,
        output: null,
        state: {},
        created_at: "2026-05-13T00:00:00Z",
        updated_at: "2026-05-13T00:10:00Z",
        completed_at: "2026-05-13T00:10:00Z",
      };
      return {
        task: {
          id: taskId,
          latest_run: latestRun,
        },
        latestRun,
      };
    }),
    getTaskRunSessionLogs: vi.fn(async () => ({
      entries: [],
      hasMore: false,
    })),
  } as unknown as CloudTaskClient;
}

function storedAgentMessage(text: string, timestamp: string) {
  return {
    type: "notification",
    timestamp,
    notification: {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "agent_message",
          content: { type: "text", text },
        },
      },
    },
  };
}

function storedTurnComplete(timestamp: string, stopReason = "end_turn") {
  return {
    type: "notification",
    timestamp,
    notification: {
      jsonrpc: "2.0",
      method: "_posthog/turn_complete",
      params: { sessionId: "session-1", stopReason },
    },
  };
}

describe("FeedbackRoutingService", () => {
  let feedbackRepo: ReturnType<typeof createMockFeedbackEventRepository>;
  let nestChat: NestChatService & { _messages: NestMessage[] };
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

  it("extracts PR URLs from the cloud structured-output wrapper", async () => {
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
    const cloudTasks = createMockCloudTaskClientWithNestedPrUrl(
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
    expect(received[0].prUrl).toBe("https://github.com/org/repo/pull/7");
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

  it("does not re-emit between emit and recordRoutedOutcome (race window)", async () => {
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
    // Renderer has NOT yet called recordRoutedOutcome — the dedupe row is
    // still in `pending`. A second poll must still skip the duplicate.
    expect(feedbackRepo._events[0].routedOutcome).toBe("pending");

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

  it("keeps review-comment events when check-run polling fails", async () => {
    const hoglet = makeHoglet({ taskId: "task-1", nestId: "nest-1" });
    const hoglets = createMockHogletService([hoglet]);
    const git = createMockGitService({
      reviewComments: [
        {
          id: 1001,
          body: "fix the edge case",
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
    (git.getPrCheckRuns as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("network down"),
    );
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
      source: "pr_review",
      payloadRef: "pr-comment:1001",
    });
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

  it("injects hedgehog messages directly into an in-progress cloud run", async () => {
    const cloudTasks = {
      injectPrompt: vi.fn(async () => ({
        accepted: true,
        processed: "queued" as const,
      })),
      getTaskWithLatestRun: vi.fn(),
    } as unknown as CloudTaskClient;
    const service = new FeedbackRoutingService(
      createMockHogletService([]),
      nests,
      createMockGitService({}),
      cloudTasks,
      feedbackRepo as unknown as FeedbackEventRepository,
      nestChat,
    );
    const received: InjectPromptEventPayload[] = [];
    service.on(FeedbackRoutingEvent.InjectPrompt, (payload) => {
      received.push(payload);
    });

    await service.routeHedgehogPrompt({
      taskId: "task-1",
      hogletId: "hoglet-1",
      nestId: "nest-1",
      prompt: "Status?",
      toolCallId: "tool-1",
      latestRunId: "run-1",
      targetRunStatus: "in_progress",
    });

    expect(cloudTasks.injectPrompt).toHaveBeenCalledWith({
      taskId: "task-1",
      taskRunId: "run-1",
      prompt: "Status?",
      authoredBy: "hedgehog",
    });
    expect(received).toHaveLength(0);
    expect(feedbackRepo._events[0]).toMatchObject({
      source: "hedgehog",
      routedOutcome: "injected",
      trustTier: "internal",
      processed: "queued",
    });
    expect(nestChat.recordHedgehogMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining(
          "→ delivered to cloud run (queued; will be read at next turn boundary)",
        ),
      }),
    );
  });

  it("retries hedgehog delivery against the fresh latest run when the tick run id is stale", async () => {
    const latestRun = {
      id: "run-2",
      task: "task-1",
      status: "in_progress",
      output: null,
      branch: null,
    };
    const cloudTasks = {
      injectPrompt: vi
        .fn()
        .mockResolvedValueOnce({ accepted: false, reason: "run_unavailable" })
        .mockResolvedValueOnce({ accepted: true, processed: "active" }),
      getTaskWithLatestRun: vi.fn(async (taskId: string) => ({
        task: { id: taskId, latest_run: latestRun },
        latestRun,
      })),
    } as unknown as CloudTaskClient;
    const service = new FeedbackRoutingService(
      createMockHogletService([]),
      nests,
      createMockGitService({}),
      cloudTasks,
      feedbackRepo as unknown as FeedbackEventRepository,
      nestChat,
    );
    const received: InjectPromptEventPayload[] = [];
    service.on(FeedbackRoutingEvent.InjectPrompt, (payload) => {
      received.push(payload);
    });

    await service.routeHedgehogPrompt({
      taskId: "task-1",
      hogletId: "hoglet-1",
      nestId: "nest-1",
      prompt: "Status?",
      toolCallId: "tool-1",
      latestRunId: "run-1",
      targetRunStatus: "in_progress",
    });

    expect(cloudTasks.injectPrompt).toHaveBeenNthCalledWith(1, {
      taskId: "task-1",
      taskRunId: "run-1",
      prompt: "Status?",
      authoredBy: "hedgehog",
    });
    expect(cloudTasks.injectPrompt).toHaveBeenNthCalledWith(2, {
      taskId: "task-1",
      taskRunId: "run-2",
      prompt: "Status?",
      authoredBy: "hedgehog",
    });
    expect(cloudTasks.getTaskWithLatestRun).toHaveBeenCalledWith("task-1");
    expect(received).toHaveLength(0);
    expect(feedbackRepo._events[0]).toMatchObject({
      source: "hedgehog",
      routedOutcome: "injected",
      trustTier: "internal",
      processed: "active",
    });
  });

  it("records failed hedgehog delivery when the cloud run rejects the prompt", async () => {
    const cloudTasks = {
      injectPrompt: vi.fn(async () => ({
        accepted: false,
        reason: "rejected",
        message: "Agent is busy",
      })),
      getTaskWithLatestRun: vi.fn(),
    } as unknown as CloudTaskClient;
    const service = new FeedbackRoutingService(
      createMockHogletService([]),
      nests,
      createMockGitService({}),
      cloudTasks,
      feedbackRepo as unknown as FeedbackEventRepository,
      nestChat,
    );
    const received: InjectPromptEventPayload[] = [];
    service.on(FeedbackRoutingEvent.InjectPrompt, (payload) => {
      received.push(payload);
    });

    await service.routeHedgehogPrompt({
      taskId: "task-1",
      hogletId: "hoglet-1",
      nestId: "nest-1",
      prompt: "Status?",
      toolCallId: "tool-1",
      latestRunId: "run-1",
      targetRunStatus: "in_progress",
    });

    expect(cloudTasks.injectPrompt).toHaveBeenCalledWith({
      taskId: "task-1",
      taskRunId: "run-1",
      prompt: "Status?",
      authoredBy: "hedgehog",
    });
    expect(cloudTasks.getTaskWithLatestRun).not.toHaveBeenCalled();
    expect(received).toHaveLength(0);
    expect(feedbackRepo._events[0]).toMatchObject({
      source: "hedgehog",
      routedOutcome: "failed",
      trustTier: "internal",
    });
  });

  it("falls back to a follow-up when stale hedgehog delivery discovers a terminal latest run", async () => {
    const latestRun = {
      id: "run-2",
      task: "task-1",
      status: "completed",
      output: null,
      branch: null,
    };
    const cloudTasks = {
      injectPrompt: vi.fn(async () => ({
        accepted: false,
        reason: "run_unavailable",
      })),
      getTaskWithLatestRun: vi.fn(async (taskId: string) => ({
        task: { id: taskId, latest_run: latestRun },
        latestRun,
      })),
    } as unknown as CloudTaskClient;
    const service = new FeedbackRoutingService(
      createMockHogletService([]),
      nests,
      createMockGitService({}),
      cloudTasks,
      feedbackRepo as unknown as FeedbackEventRepository,
      nestChat,
    );
    const received: InjectPromptEventPayload[] = [];
    service.on(FeedbackRoutingEvent.InjectPrompt, (payload) => {
      received.push(payload);
    });

    await service.routeHedgehogPrompt({
      taskId: "task-1",
      hogletId: "hoglet-1",
      nestId: "nest-1",
      prompt: "Please follow up.",
      toolCallId: "tool-1",
      latestRunId: "run-1",
      targetRunStatus: "in_progress",
    });

    expect(cloudTasks.getTaskWithLatestRun).toHaveBeenCalledWith("task-1");
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      source: "hedgehog",
      fallbackPrompt: "Please follow up.",
      targetRunStatus: "completed",
    });
    expect(feedbackRepo._events[0]).toMatchObject({
      source: "hedgehog",
      routedOutcome: "pending",
      trustTier: "internal",
    });
  });

  it("records failed hedgehog delivery when no in-progress run can accept it", async () => {
    const service = new FeedbackRoutingService(
      createMockHogletService([]),
      nests,
      createMockGitService({}),
      createMockCloudTaskClient(null),
      feedbackRepo as unknown as FeedbackEventRepository,
      nestChat,
    );

    await service.routeHedgehogPrompt({
      taskId: "task-1",
      hogletId: "hoglet-1",
      nestId: "nest-1",
      prompt: "Status?",
      toolCallId: "tool-1",
      latestRunId: null,
      targetRunStatus: "queued",
    });

    expect(nestChat.recordHedgehogMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining(
          "the hoglet's cloud run is not currently accepting messages",
        ),
      }),
    );
    expect(nestChat.recordHedgehogMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining(
          "retry only if the question is still useful",
        ),
      }),
    );
  });

  it("emits a follow-up fallback event for terminal hedgehog targets", async () => {
    const cloudTasks = createMockCloudTaskClient(null);
    const service = new FeedbackRoutingService(
      createMockHogletService([]),
      nests,
      createMockGitService({}),
      cloudTasks,
      feedbackRepo as unknown as FeedbackEventRepository,
      nestChat,
    );
    const received: InjectPromptEventPayload[] = [];
    service.on(FeedbackRoutingEvent.InjectPrompt, (payload) => {
      received.push(payload);
    });

    await service.routeHedgehogPrompt({
      taskId: "task-1",
      hogletId: "hoglet-1",
      nestId: "nest-1",
      prompt: "Please address this follow-up.",
      toolCallId: "tool-1",
      latestRunId: "run-1",
      targetRunStatus: "completed",
    });

    expect(cloudTasks.injectPrompt).not.toHaveBeenCalled();
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      taskId: "task-1",
      source: "hedgehog",
      fallbackPrompt: "Please address this follow-up.",
      targetRunStatus: "completed",
    });
    expect(feedbackRepo._events[0]).toMatchObject({
      source: "hedgehog",
      routedOutcome: "pending",
      trustTier: "internal",
    });
  });

  it("keeps failed external feedback copy as no-route logged-only", () => {
    const service = new FeedbackRoutingService(
      createMockHogletService([]),
      nests,
      createMockGitService({}),
      createMockCloudTaskClient(null),
      feedbackRepo as unknown as FeedbackEventRepository,
      nestChat,
    );

    service.recordRoutedOutcome({
      nestId: "nest-1",
      hogletTaskId: "task-1",
      source: "pr_review",
      payloadHash: "hash-review",
      payloadRef: "pr-comment:1",
      routedOutcome: "failed",
    });

    expect(nestChat.recordHedgehogMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining(
          "no active session, no nest; logged only",
        ),
      }),
    );
  });

  it("keeps injected and follow-up routing audit copy unchanged", () => {
    const service = new FeedbackRoutingService(
      createMockHogletService([]),
      nests,
      createMockGitService({}),
      createMockCloudTaskClient(null),
      feedbackRepo as unknown as FeedbackEventRepository,
      nestChat,
    );

    service.recordRoutedOutcome({
      nestId: "nest-1",
      hogletTaskId: "task-1",
      source: "pr_review",
      payloadHash: "hash-injected",
      payloadRef: "pr-comment:1",
      routedOutcome: "injected",
    });
    service.recordRoutedOutcome({
      nestId: "nest-1",
      hogletTaskId: "task-1",
      source: "ci",
      payloadHash: "hash-follow-up",
      payloadRef: "ci:1",
      routedOutcome: "follow_up_spawned",
    });

    expect(nestChat.recordHedgehogMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("→ injected into live session"),
      }),
    );
    expect(nestChat.recordHedgehogMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("→ spawned a follow-up hoglet"),
      }),
    );
  });

  it("writes a hoglet_summary message from completed terminal output", async () => {
    const hoglet = makeHoglet({
      id: "hoglet-1",
      taskId: "task-1",
      nestId: "nest-1",
    });
    const hoglets = createMockHogletService([hoglet]);
    const git = createMockGitService({});
    const cloudTasks = createMockCloudTaskClientWithCompletedRun({
      pr_url: "https://github.com/org/repo/pull/7",
    });
    const service = new FeedbackRoutingService(
      hoglets,
      nests,
      git,
      cloudTasks,
      feedbackRepo as unknown as FeedbackEventRepository,
      nestChat,
    );

    await service.runPoll();

    expect(nestChat.recordHogletSummary).toHaveBeenCalledWith({
      nestId: "nest-1",
      hogletId: "hoglet-1",
      taskId: "task-1",
      runId: "run-1",
      terminalReason: "completed",
      body: "Run completed and produced a pull request: https://github.com/org/repo/pull/7",
    });
    expect(nestChat._messages).toHaveLength(1);
    expect(nestChat._messages[0]).toMatchObject({
      kind: "hoglet_summary",
      sourceTaskId: "task-1",
    });
    expect(JSON.parse(nestChat._messages[0].payloadJson ?? "{}")).toEqual({
      hogletId: "hoglet-1",
      runId: "run-1",
      terminalReason: "completed",
    });
    expect(nests.emitMessageAppended).toHaveBeenCalledTimes(1);
  });

  it("does not duplicate hoglet_summary messages for the same task and run", async () => {
    const hoglet = makeHoglet({
      id: "hoglet-1",
      taskId: "task-1",
      nestId: "nest-1",
    });
    const hoglets = createMockHogletService([hoglet]);
    const git = createMockGitService({});
    const cloudTasks = createMockCloudTaskClientWithCompletedRun({
      output: { pr_url: "https://github.com/org/repo/pull/7" },
    });
    const service = new FeedbackRoutingService(
      hoglets,
      nests,
      git,
      cloudTasks,
      feedbackRepo as unknown as FeedbackEventRepository,
      nestChat,
    );

    await service.runPoll();
    (
      service as unknown as {
        lastPolledAt: Map<string, number>;
      }
    ).lastPolledAt.clear();
    await service.runPoll();

    expect(nestChat.recordHogletSummary).toHaveBeenCalledTimes(2);
    expect(nestChat._messages).toHaveLength(1);
    expect(nests.emitMessageAppended).toHaveBeenCalledTimes(1);
  });

  it("writes one hoglet_message per completed turn from cloud session logs", async () => {
    const hoglet = makeHoglet({
      id: "hoglet-1",
      taskId: "task-1",
      nestId: "nest-1",
    });
    const hoglets = createMockHogletService([hoglet]);
    const git = createMockGitService({});
    const cloudTasks = {
      getTaskWithLatestRun: vi.fn(async (taskId: string) => {
        const latestRun = {
          id: "run-1",
          task: taskId,
          team: 1,
          branch: null,
          status: "in_progress",
          log_url: "",
          error_message: null,
          output: null,
          state: {},
          created_at: "2026-05-13T00:00:00Z",
          updated_at: "2026-05-13T00:05:00Z",
          completed_at: null,
        };
        return {
          task: {
            id: taskId,
            latest_run: latestRun,
          },
          latestRun,
        };
      }),
      getTaskRunSessionLogs: vi.fn(async () => ({
        entries: [
          storedAgentMessage(
            "Working on the scaffold.",
            "2026-05-13T00:01:00Z",
          ),
          storedTurnComplete("2026-05-13T00:01:01Z", "tool_use"),
          storedAgentMessage("I shipped it. PR is up.", "2026-05-13T00:05:00Z"),
          storedTurnComplete("2026-05-13T00:05:01Z"),
        ],
        hasMore: false,
      })),
    } as unknown as CloudTaskClient;
    const service = new FeedbackRoutingService(
      hoglets,
      nests,
      git,
      cloudTasks,
      feedbackRepo as unknown as FeedbackEventRepository,
      nestChat,
    );

    await service.runPoll();

    expect(cloudTasks.getTaskRunSessionLogs).toHaveBeenCalledWith({
      taskId: "task-1",
      runId: "run-1",
      offset: 0,
      limit: 200,
    });
    expect(nestChat.recordHogletMessage).toHaveBeenNthCalledWith(1, {
      nestId: "nest-1",
      hogletId: "hoglet-1",
      taskId: "task-1",
      runId: "run-1",
      turnIndex: 0,
      body: "Working on the scaffold.",
      stopReason: "tool_use",
    });
    expect(nestChat.recordHogletMessage).toHaveBeenNthCalledWith(2, {
      nestId: "nest-1",
      hogletId: "hoglet-1",
      taskId: "task-1",
      runId: "run-1",
      turnIndex: 1,
      body: "I shipped it. PR is up.",
      stopReason: "end_turn",
    });
    expect(nestChat._messages.map((message) => message.kind)).toEqual([
      "hoglet_message",
      "hoglet_message",
    ]);
    expect(nestChat.recordHogletSummary).not.toHaveBeenCalled();
    expect(nests.emitMessageAppended).toHaveBeenCalledTimes(2);
  });

  it("writes a hoglet_summary for branch-only completed output", async () => {
    const hoglet = makeHoglet({
      id: "hoglet-1",
      taskId: "task-1",
      nestId: "nest-1",
    });
    const hoglets = createMockHogletService([hoglet]);
    const git = createMockGitService({});
    const cloudTasks = createMockCloudTaskClientWithCompletedRun({
      head_branch: "hedgemony/task-1",
    });
    const service = new FeedbackRoutingService(
      hoglets,
      nests,
      git,
      cloudTasks,
      feedbackRepo as unknown as FeedbackEventRepository,
      nestChat,
    );

    await service.runPoll();

    expect(nestChat.recordHogletSummary).toHaveBeenCalledWith({
      nestId: "nest-1",
      hogletId: "hoglet-1",
      taskId: "task-1",
      runId: "run-1",
      terminalReason: "completed",
      body: "Run completed on branch: hedgemony/task-1",
    });
    expect(nestChat._messages).toHaveLength(1);
    expect(nests.emitMessageAppended).toHaveBeenCalledTimes(1);
  });

  it("writes a generic hoglet_summary when a completed run has no structured output", async () => {
    const hoglet = makeHoglet({
      id: "hoglet-1",
      taskId: "task-1",
      nestId: "nest-1",
    });
    const hoglets = createMockHogletService([hoglet]);
    const git = createMockGitService({});
    const cloudTasks = createMockCloudTaskClientWithCompletedRun({});
    const service = new FeedbackRoutingService(
      hoglets,
      nests,
      git,
      cloudTasks,
      feedbackRepo as unknown as FeedbackEventRepository,
      nestChat,
    );

    await service.runPoll();

    expect(nestChat.recordHogletSummary).toHaveBeenCalledWith({
      nestId: "nest-1",
      hogletId: "hoglet-1",
      taskId: "task-1",
      runId: "run-1",
      terminalReason: "completed",
      body: "Run completed without structured output. Review the task before deciding whether follow-up work is needed.",
    });
    expect(nestChat._messages).toHaveLength(1);
    expect(nests.emitMessageAppended).toHaveBeenCalledTimes(1);
  });

  it("writes a hoglet_summary when a run fails", async () => {
    const hoglet = makeHoglet({
      id: "hoglet-1",
      taskId: "task-1",
      nestId: "nest-1",
    });
    const hoglets = createMockHogletService([hoglet]);
    const git = createMockGitService({});
    const cloudTasks = createMockCloudTaskClientWithTerminalRun({
      status: "failed",
      errorMessage: "The branch could not be pushed.",
    });
    const service = new FeedbackRoutingService(
      hoglets,
      nests,
      git,
      cloudTasks,
      feedbackRepo as unknown as FeedbackEventRepository,
      nestChat,
    );

    await service.runPoll();

    expect(nestChat.recordHogletSummary).toHaveBeenCalledWith({
      nestId: "nest-1",
      hogletId: "hoglet-1",
      taskId: "task-1",
      runId: "run-1",
      terminalReason: "failed",
      body: "Run failed: The branch could not be pushed.",
    });
    expect(nestChat._messages).toHaveLength(1);
    expect(nests.emitMessageAppended).toHaveBeenCalledTimes(1);
  });

  it("writes a hoglet_summary when a run is cancelled", async () => {
    const hoglet = makeHoglet({
      id: "hoglet-1",
      taskId: "task-1",
      nestId: "nest-1",
    });
    const hoglets = createMockHogletService([hoglet]);
    const git = createMockGitService({});
    const cloudTasks = createMockCloudTaskClientWithTerminalRun({
      status: "cancelled",
    });
    const service = new FeedbackRoutingService(
      hoglets,
      nests,
      git,
      cloudTasks,
      feedbackRepo as unknown as FeedbackEventRepository,
      nestChat,
    );

    await service.runPoll();

    expect(nestChat.recordHogletSummary).toHaveBeenCalledWith({
      nestId: "nest-1",
      hogletId: "hoglet-1",
      taskId: "task-1",
      runId: "run-1",
      terminalReason: "cancelled",
      body: "Run cancelled.",
    });
    expect(nestChat._messages).toHaveLength(1);
    expect(nests.emitMessageAppended).toHaveBeenCalledTimes(1);
  });
});

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

import type { SignalReport } from "../../../shared/types";
import type { CloudTaskClient } from "./cloud-task-client";
import type { HogletService } from "./hoglet-service";
import type { Hoglet, HogletIngestedEventPayload } from "./schemas";
import {
  SignalIngestionEvent,
  SignalIngestionService,
} from "./signal-ingestion-service";

function makeReport(overrides: Partial<SignalReport> = {}): SignalReport {
  return {
    id: overrides.id ?? "report-1",
    title: overrides.title ?? "Checkout regression",
    summary: overrides.summary ?? "Users hit a 500 on /checkout.",
    status: overrides.status ?? "ready",
    total_weight: overrides.total_weight ?? 1,
    signal_count: overrides.signal_count ?? 1,
    created_at: overrides.created_at ?? "2026-05-13T00:00:00Z",
    updated_at: overrides.updated_at ?? "2026-05-13T00:00:00Z",
    artefact_count: overrides.artefact_count ?? 0,
    already_addressed: overrides.already_addressed ?? null,
    implementation_pr_url: overrides.implementation_pr_url ?? null,
  };
}

function makeHoglet(overrides: Partial<Hoglet> = {}): Hoglet {
  return {
    id: overrides.id ?? "hoglet-1",
    name: overrides.name ?? null,
    taskId: overrides.taskId ?? "task-1",
    nestId: overrides.nestId ?? null,
    signalReportId: overrides.signalReportId ?? "report-1",
    affinityScore: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  };
}

function createMockCloudTaskClient(opts: {
  reports?: SignalReport[];
  artefactResults?: unknown[];
  listError?: Error;
}): CloudTaskClient {
  return {
    listSignalReports: vi.fn(async () => {
      if (opts.listError) throw opts.listError;
      const results = opts.reports ?? [];
      return { results, count: results.length };
    }),
    getSignalReportArtefacts: vi.fn(async () => ({
      results: opts.artefactResults ?? [],
      count: opts.artefactResults?.length ?? 0,
    })),
  } as unknown as CloudTaskClient;
}

function createMockHogletService(
  spawnImpl?: (args: {
    prompt: string;
    signalReportId: string;
  }) => Promise<Hoglet>,
): HogletService {
  return {
    spawnSignalBacked: vi.fn(
      spawnImpl ??
        (async ({ signalReportId }) =>
          makeHoglet({ signalReportId, taskId: `task-${signalReportId}` })),
    ),
  } as unknown as HogletService;
}

describe("SignalIngestionService", () => {
  let cloudTasks: CloudTaskClient;
  let hoglets: HogletService;

  beforeEach(() => {
    vi.useRealTimers();
  });

  it("emits hogletIngested for each new signal report on a poll cycle", async () => {
    cloudTasks = createMockCloudTaskClient({
      reports: [makeReport({ id: "r1" }), makeReport({ id: "r2" })],
    });
    hoglets = createMockHogletService();
    const service = new SignalIngestionService(cloudTasks, hoglets);

    const received: HogletIngestedEventPayload[] = [];
    service.on(SignalIngestionEvent.HogletIngested, (e) => {
      received.push(e);
    });

    await service.runPoll();

    expect(received).toHaveLength(2);
    expect(received.map((e) => e.signalReportId).sort()).toEqual(["r1", "r2"]);
    expect(hoglets.spawnSignalBacked).toHaveBeenCalledTimes(2);
  });

  it("skips reports flagged as already_addressed or with an implementation PR", async () => {
    cloudTasks = createMockCloudTaskClient({
      reports: [
        makeReport({ id: "skip-addressed", already_addressed: true }),
        makeReport({
          id: "skip-pr",
          implementation_pr_url: "https://github.com/org/repo/pull/1",
        }),
        makeReport({ id: "keep" }),
      ],
    });
    hoglets = createMockHogletService();
    const service = new SignalIngestionService(cloudTasks, hoglets);

    await service.runPoll();

    expect(hoglets.spawnSignalBacked).toHaveBeenCalledTimes(1);
    expect(hoglets.spawnSignalBacked).toHaveBeenCalledWith(
      expect.objectContaining({ signalReportId: "keep" }),
    );
  });

  it("survives a listSignalReports failure without throwing", async () => {
    cloudTasks = createMockCloudTaskClient({
      listError: new Error("network down"),
    });
    hoglets = createMockHogletService();
    const service = new SignalIngestionService(cloudTasks, hoglets);

    await expect(service.runPoll()).resolves.toBeUndefined();
    expect(hoglets.spawnSignalBacked).not.toHaveBeenCalled();
  });

  it("isolates one report's spawn failure from siblings", async () => {
    cloudTasks = createMockCloudTaskClient({
      reports: [
        makeReport({ id: "good-1" }),
        makeReport({ id: "bad" }),
        makeReport({ id: "good-2" }),
      ],
    });
    hoglets = createMockHogletService(async ({ signalReportId }) => {
      if (signalReportId === "bad") throw new Error("cloud-down");
      return makeHoglet({ signalReportId, taskId: `task-${signalReportId}` });
    });
    const service = new SignalIngestionService(cloudTasks, hoglets);

    const received: HogletIngestedEventPayload[] = [];
    service.on(SignalIngestionEvent.HogletIngested, (e) => {
      received.push(e);
    });

    await service.runPoll();

    expect(received.map((e) => e.signalReportId).sort()).toEqual([
      "good-1",
      "good-2",
    ]);
  });

  it("caps a single poll cycle at MAX_INGESTIONS_PER_TICK", async () => {
    const reports = Array.from({ length: 10 }, (_, i) =>
      makeReport({ id: `r${i}` }),
    );
    cloudTasks = createMockCloudTaskClient({ reports });
    hoglets = createMockHogletService();
    const service = new SignalIngestionService(cloudTasks, hoglets);

    await service.runPoll();

    expect(hoglets.spawnSignalBacked).toHaveBeenCalledTimes(5);
  });

  it("start is idempotent and cancel stops the loop", () => {
    cloudTasks = createMockCloudTaskClient({ reports: [] });
    hoglets = createMockHogletService();
    const service = new SignalIngestionService(cloudTasks, hoglets);

    service.start();
    service.start();
    expect(service.isRunning()).toBe(true);

    service.cancel();
    expect(service.isRunning()).toBe(false);
    // cancel is safe to call twice.
    service.cancel();
  });
});

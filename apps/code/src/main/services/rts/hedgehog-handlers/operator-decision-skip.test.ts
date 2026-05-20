import { describe, expect, it, vi } from "vitest";
import type { OperatorDecision } from "../../../db/repositories/operator-decision-repository";
import type { PrDependency } from "../../../db/repositories/pr-dependency-repository";
import type { AnthropicToolUseBlock } from "../../llm-gateway/schemas";
import type { CloudTaskClient } from "../cloud-task-client";
import type { FeedbackRoutingService } from "../feedback-routing-service";
import type { HogletWithState } from "../hedgehog-prompts";
import type { HogletService } from "../hoglet-service";
import type { NestService } from "../nest-service";
import type { PrGraphService } from "../pr-graph-service";
import type { Hoglet, Nest, NestLoadout } from "../schemas";
import { killHogletHandler } from "./kill-hoglet-handler";
import { spawnHogletHandler } from "./spawn-hoglet-handler";
import { type HedgehogToolDeps, TickBudget, type TickContext } from "./types";

function makeNest(overrides: Partial<Nest> = {}): Nest {
  return {
    id: "nest-1",
    name: "nest",
    goalPrompt: "do the thing",
    definitionOfDone: null,
    mapX: 0,
    mapY: 0,
    status: "active",
    health: "ok",
    targetMetricId: null,
    loadoutJson: null,
    primaryRepository: "org/repo",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeHoglet(overrides: Partial<Hoglet> = {}): Hoglet {
  return {
    id: "hoglet-1",
    name: "hoglet",
    taskId: "task-1",
    nestId: "nest-1",
    signalReportId: null,
    affinityScore: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

function makeHogletWithState(
  overrides: Partial<HogletWithState> = {},
): HogletWithState {
  return {
    hoglet: overrides.hoglet ?? makeHoglet(),
    repository: overrides.repository ?? "org/repo",
    taskRunStatus: overrides.taskRunStatus ?? "in_progress",
    latestRunId: overrides.latestRunId ?? "run-1",
    branch: overrides.branch ?? null,
    prUrl: overrides.prUrl ?? null,
    prState: overrides.prState ?? null,
    latestRunCreatedAt: overrides.latestRunCreatedAt ?? null,
    latestRunCompletedAt: overrides.latestRunCompletedAt ?? null,
    lastOutputAt: overrides.lastOutputAt ?? null,
    lastOutputKind: overrides.lastOutputKind ?? null,
    lastOutputPreview: overrides.lastOutputPreview ?? null,
    pendingInjections: overrides.pendingInjections ?? {
      count: 0,
      oldestAgeMinutes: null,
    },
  };
}

function makeContext(overrides: {
  nest?: Nest;
  hoglets?: HogletWithState[];
  operatorDecisions: OperatorDecision[];
  prDependencies?: PrDependency[];
  loadout?: NestLoadout;
}): TickContext {
  return {
    nest: overrides.nest ?? makeNest(),
    hoglets: overrides.hoglets ?? [],
    budget: new TickBudget(),
    prDependencies: overrides.prDependencies ?? [],
    loadout: overrides.loadout ?? {},
    nestAnomalies: {},
    operatorDecisions: overrides.operatorDecisions,
    repositoryContext: {
      repositories: ["org/repo"],
      primaryRepository: "org/repo",
      availableRepositories: ["org/repo"],
    },
  };
}

function makeDeps(overrides: Partial<HedgehogToolDeps> = {}): {
  deps: HedgehogToolDeps;
  writeNestMessage: ReturnType<typeof vi.fn>;
  spawnInNest: ReturnType<typeof vi.fn>;
  updateTaskRun: ReturnType<typeof vi.fn>;
} {
  const writeNestMessage = vi.fn();
  const spawnInNest = vi.fn();
  const updateTaskRun = vi.fn();
  const deps: HedgehogToolDeps = {
    cloudTasks: {
      updateTaskRun,
      resolveGithubUserIntegration: vi.fn(async () => "integration-1"),
      listAccessibleRepositorySlugs: vi.fn(async () => []),
    } as unknown as CloudTaskClient,
    prGraph: {} as PrGraphService,
    feedbackRouting: {} as FeedbackRoutingService,
    hogletService: {
      spawnInNest,
    } as unknown as HogletService,
    nestService: {} as NestService,
    writeNestMessage,
    ...overrides,
  };
  return { deps, writeNestMessage, spawnInNest, updateTaskRun };
}

function block(
  name: string,
  input: Record<string, unknown>,
): AnthropicToolUseBlock {
  return { id: "block-1", name, input };
}

function decision(overrides: Partial<OperatorDecision>): OperatorDecision {
  const now = new Date().toISOString();
  return {
    id: "decision-1",
    nestId: "nest-1",
    kind: "suppress_signal_report",
    subjectKey: "signal-1",
    reason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("spawn_hoglet operator-override skip", () => {
  it("skips spawn when the signal report has been suppressed", async () => {
    const ctx = makeContext({
      operatorDecisions: [
        decision({
          kind: "suppress_signal_report",
          subjectKey: "signal-x",
          reason: "operator dismissed",
        }),
      ],
    });
    const { deps, writeNestMessage, spawnInNest } = makeDeps();

    const result = await spawnHogletHandler.handle(
      ctx,
      block("spawn_hoglet", {
        prompt: "do work",
        repository: "org/repo",
        signal_report_id: "signal-x",
      }),
      deps,
    );

    expect(result.success).toBe(false);
    expect(result.scratchpadSummary).toContain("Operator suppressed");
    expect(spawnInNest).not.toHaveBeenCalled();
    expect(writeNestMessage).toHaveBeenCalledWith(
      "nest-1",
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          type: "spawn_suppressed_by_operator",
          signalReportId: "signal-x",
        }),
      }),
    );
  });

  it("spawns normally when no suppression matches the signal report", async () => {
    const ctx = makeContext({
      operatorDecisions: [
        decision({
          kind: "suppress_signal_report",
          subjectKey: "signal-OTHER",
        }),
      ],
    });
    const { deps, spawnInNest } = makeDeps();
    spawnInNest.mockResolvedValue({
      hoglet: makeHoglet({ id: "hoglet-new" }),
      taskRunId: "run-new",
    });

    const result = await spawnHogletHandler.handle(
      ctx,
      block("spawn_hoglet", {
        prompt: "do work",
        repository: "org/repo",
        signal_report_id: "signal-fresh",
      }),
      deps,
    );

    expect(result.success).toBe(true);
    expect(spawnInNest).toHaveBeenCalledOnce();
  });

  it("refuses an inaccessible repository with fuzzy suggestions", async () => {
    const ctx: TickContext = {
      ...makeContext({ operatorDecisions: [] }),
      nest: makeNest({ primaryRepository: "org/reppo" }),
      repositoryContext: {
        repositories: ["org/reppo"],
        primaryRepository: "org/reppo",
        availableRepositories: ["org/reppo"],
      },
    };
    const { deps, writeNestMessage, spawnInNest } = makeDeps({
      cloudTasks: {
        resolveGithubUserIntegration: vi.fn(async () => null),
        listAccessibleRepositorySlugs: vi.fn(async () => ["org/repo"]),
      } as unknown as CloudTaskClient,
    });

    const result = await spawnHogletHandler.handle(
      ctx,
      block("spawn_hoglet", {
        prompt: "do work",
      }),
      deps,
    );

    expect(result.success).toBe(false);
    expect(result.scratchpadSummary).toContain("suggestions: org/repo");
    expect(spawnInNest).not.toHaveBeenCalled();
    expect(writeNestMessage).toHaveBeenCalledWith(
      "nest-1",
      expect.objectContaining({
        body: expect.stringContaining("Did you mean: org/repo?"),
        payloadJson: expect.objectContaining({
          type: "spawn_repository_not_accessible",
          suggestions: ["org/repo"],
        }),
      }),
    );
  });
});

describe("kill_hoglet operator-override skip", () => {
  it("skips kill when the hoglet has been revived by id", async () => {
    const hoglet = makeHoglet({ id: "hoglet-revived", taskId: "task-r" });
    const ctx = makeContext({
      hoglets: [makeHogletWithState({ hoglet })],
      operatorDecisions: [
        decision({
          kind: "revive_hoglet",
          subjectKey: "hoglet-revived",
          reason: "needed",
        }),
      ],
    });
    const { deps, writeNestMessage, updateTaskRun } = makeDeps();

    const result = await killHogletHandler.handle(
      ctx,
      block("kill_hoglet", {
        hoglet_id: "hoglet-revived",
        reason: "off-track",
      }),
      deps,
    );

    expect(result.success).toBe(false);
    expect(result.scratchpadSummary).toContain("Operator revived");
    expect(updateTaskRun).not.toHaveBeenCalled();
    expect(writeNestMessage).toHaveBeenCalledWith(
      "nest-1",
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          type: "kill_suppressed_by_operator",
          hogletId: "hoglet-revived",
        }),
      }),
    );
  });

  it("skips kill when the revive decision keyed on taskId", async () => {
    const hoglet = makeHoglet({ id: "hoglet-a", taskId: "task-keep" });
    const ctx = makeContext({
      hoglets: [makeHogletWithState({ hoglet })],
      operatorDecisions: [
        decision({ kind: "revive_hoglet", subjectKey: "task-keep" }),
      ],
    });
    const { deps, updateTaskRun } = makeDeps();

    const result = await killHogletHandler.handle(
      ctx,
      block("kill_hoglet", { hoglet_id: "hoglet-a", reason: "off-track" }),
      deps,
    );

    expect(result.success).toBe(false);
    expect(updateTaskRun).not.toHaveBeenCalled();
  });

  it("kills normally when no revive decision matches", async () => {
    const hoglet = makeHoglet({ id: "hoglet-b", taskId: "task-b" });
    const ctx = makeContext({
      hoglets: [makeHogletWithState({ hoglet })],
      operatorDecisions: [
        decision({ kind: "revive_hoglet", subjectKey: "hoglet-different" }),
      ],
    });
    const { deps, updateTaskRun } = makeDeps();
    updateTaskRun.mockResolvedValue(undefined);

    const result = await killHogletHandler.handle(
      ctx,
      block("kill_hoglet", { hoglet_id: "hoglet-b", reason: "off-track" }),
      deps,
    );

    expect(result.success).toBe(true);
    expect(updateTaskRun).toHaveBeenCalledOnce();
  });
});

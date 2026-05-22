import { vi } from "vitest";
import type { OperatorDecision } from "../../../db/repositories/rts/operator-decision-repository";
import type { PrDependency } from "../../../db/repositories/rts/pr-dependency-repository";
import type { AnthropicToolUseBlock } from "../../llm-gateway/schemas";
import type { CloudTaskClient } from "../cloud-task-client";
import type { FeedbackRoutingService } from "../feedback-routing-service";
import type { HogletWithState } from "../hedgehog-prompts";
import type { HogletService } from "../hoglet-service";
import type { NestService } from "../nest-service";
import type { PrGraphService } from "../pr-graph-service";
import type { Hoglet, Nest, NestLoadout } from "../schemas";
import { type HedgehogToolDeps, TickBudget, type TickContext } from "./types";

export function makeNest(overrides: Partial<Nest> = {}): Nest {
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

export function makeHoglet(overrides: Partial<Hoglet> = {}): Hoglet {
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

export function makeHogletWithState(
  overrides: Partial<HogletWithState> = {},
): HogletWithState {
  return {
    hoglet: makeHoglet(),
    repository: "org/repo",
    taskRunStatus: "in_progress",
    latestRunId: "run-1",
    branch: null,
    prUrl: null,
    prState: null,
    latestRunCreatedAt: null,
    latestRunCompletedAt: null,
    lastOutputAt: null,
    lastOutputKind: null,
    lastOutputPreview: null,
    pendingInjections: {
      count: 0,
      oldestAgeMinutes: null,
    },
    ...overrides,
  };
}

export interface MakeContextOverrides {
  nest?: Nest;
  hoglets?: HogletWithState[];
  operatorDecisions?: OperatorDecision[];
  prDependencies?: PrDependency[];
  loadout?: NestLoadout;
  availableRepositories?: string[];
  primaryRepository?: string | null;
}

export function makeContext(overrides: MakeContextOverrides = {}): TickContext {
  const availableRepositories = overrides.availableRepositories ?? ["org/repo"];
  const primaryRepository =
    overrides.primaryRepository === undefined
      ? "org/repo"
      : overrides.primaryRepository;
  return {
    nest: overrides.nest ?? makeNest(),
    hoglets: overrides.hoglets ?? [],
    budget: new TickBudget(),
    prDependencies: overrides.prDependencies ?? [],
    loadout: overrides.loadout ?? {},
    nestAnomalies: {},
    operatorDecisions: overrides.operatorDecisions ?? [],
    repositoryContext: {
      repositories: availableRepositories,
      primaryRepository,
      availableRepositories,
    },
  };
}

export interface MockDeps {
  deps: HedgehogToolDeps;
  writeNestMessage: ReturnType<typeof vi.fn>;
  cloudTasks: {
    createTaskRun: ReturnType<typeof vi.fn>;
    startTaskRun: ReturnType<typeof vi.fn>;
    updateTaskRun: ReturnType<typeof vi.fn>;
    resolveGithubUserIntegration: ReturnType<typeof vi.fn>;
    listAccessibleRepositorySlugs: ReturnType<typeof vi.fn>;
  };
  prGraph: {
    link: ReturnType<typeof vi.fn>;
    unlink: ReturnType<typeof vi.fn>;
    requestRebase: ReturnType<typeof vi.fn>;
  };
  feedbackRouting: {
    routeHedgehogPrompt: ReturnType<typeof vi.fn>;
  };
  hogletService: {
    spawnInNest: ReturnType<typeof vi.fn>;
    ensureCloudWorkspace: ReturnType<typeof vi.fn>;
  };
  nestService: {
    markValidated: ReturnType<typeof vi.fn>;
  };
}

export function makeMockDeps(): MockDeps {
  const writeNestMessage = vi.fn();
  const cloudTasks = {
    createTaskRun: vi.fn(),
    startTaskRun: vi.fn(),
    updateTaskRun: vi.fn(),
    resolveGithubUserIntegration: vi.fn(async () => "integration-1"),
    listAccessibleRepositorySlugs: vi.fn(async () => []),
  };
  const prGraph = {
    link: vi.fn(),
    unlink: vi.fn(),
    requestRebase: vi.fn(),
  };
  const feedbackRouting = {
    routeHedgehogPrompt: vi.fn(async () => undefined),
  };
  const hogletService = {
    spawnInNest: vi.fn(),
    ensureCloudWorkspace: vi.fn(async () => undefined),
  };
  const nestService = {
    markValidated: vi.fn(),
  };
  const deps: HedgehogToolDeps = {
    cloudTasks: cloudTasks as unknown as CloudTaskClient,
    prGraph: prGraph as unknown as PrGraphService,
    feedbackRouting: feedbackRouting as unknown as FeedbackRoutingService,
    hogletService: hogletService as unknown as HogletService,
    nestService: nestService as unknown as NestService,
    writeNestMessage,
  };
  return {
    deps,
    writeNestMessage,
    cloudTasks,
    prGraph,
    feedbackRouting,
    hogletService,
    nestService,
  };
}

export function makeToolBlock(
  name: string,
  input: Record<string, unknown>,
): AnthropicToolUseBlock {
  return { id: "block-1", name, input };
}

export function makeOperatorDecision(
  overrides: Partial<OperatorDecision>,
): OperatorDecision {
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

export function makePrDependency(
  overrides: Partial<PrDependency> = {},
): PrDependency {
  const now = new Date().toISOString();
  return {
    id: "edge-1",
    nestId: "nest-1",
    parentTaskId: "task-parent",
    childTaskId: "task-child",
    state: "pending",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

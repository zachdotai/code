import { describe, expect, it } from "vitest";
import {
  buildUserPrompt,
  deriveHogletLastOutput,
  type HogletWithState,
} from "./hedgehog-prompts";
import type { Hoglet, Nest, NestMessage } from "./schemas";

function makeNest(overrides: Partial<Nest> = {}): Nest {
  return {
    id: "nest-1",
    name: "Checkout lift",
    goalPrompt: "Improve checkout conversion.",
    definitionOfDone: "All checkout tests pass.",
    mapX: 0,
    mapY: 0,
    status: "active",
    health: "ok",
    targetMetricId: null,
    loadoutJson: null,
    primaryRepository: "posthog/posthog",
    createdAt: "2026-05-18T17:00:00.000Z",
    updatedAt: "2026-05-18T17:00:00.000Z",
    ...overrides,
  };
}

function makeHoglet(overrides: Partial<Hoglet> = {}): Hoglet {
  return {
    id: "hoglet-1",
    name: "Jovan",
    taskId: "task-1",
    nestId: "nest-1",
    signalReportId: null,
    affinityScore: null,
    createdAt: "2026-05-18T17:00:00.000Z",
    updatedAt: "2026-05-18T17:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<NestMessage> = {}): NestMessage {
  return {
    id: "message-1",
    nestId: "nest-1",
    kind: "tool_result",
    visibility: "summary",
    sourceTaskId: "task-1",
    body: "Verification complete.",
    payloadJson: null,
    createdAt: "2026-05-18T17:27:04.000Z",
    ...overrides,
  };
}

function makeHogletState(
  overrides: Partial<HogletWithState> = {},
): HogletWithState {
  return {
    hoglet: overrides.hoglet ?? makeHoglet(),
    repository: overrides.repository ?? "posthog/posthog",
    taskRunStatus: overrides.taskRunStatus ?? "in_progress",
    latestRunId: overrides.latestRunId ?? "run-1",
    branch: overrides.branch ?? null,
    prUrl: overrides.prUrl ?? null,
    prState: overrides.prState ?? null,
    latestRunCreatedAt:
      overrides.latestRunCreatedAt ?? "2026-05-18T17:10:00.000Z",
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

function renderPrompt(
  hoglets: HogletWithState[],
  recentChat: NestMessage[] = [],
): string {
  return buildUserPrompt({
    nest: makeNest(),
    hoglets,
    recentChat,
    scratchpad: [],
    triggerReason: "test",
    prDependencies: [],
    loadout: {},
    repositoryContext: {
      repositories: ["posthog/posthog"],
      primaryRepository: "posthog/posthog",
      availableRepositories: ["posthog/posthog"],
    },
    nestAnomalies: {},
  });
}

describe("buildUserPrompt", () => {
  it("includes last_output fields for matching hoglet output newer than the run", () => {
    const base = makeHogletState();
    const output = makeMessage({
      body: "Verification complete — all child PRs are open and clean.",
      createdAt: "2026-05-18T17:27:04.000Z",
    });
    const prompt = renderPrompt([
      { ...base, ...deriveHogletLastOutput(base, [output]) },
    ]);

    expect(prompt).toContain("last_output_at: 2026-05-18T17:27:04.000Z");
    expect(prompt).toContain("last_output_kind: tool_result");
    expect(prompt).toContain(
      "last_output_preview: Verification complete — all child PRs are open and clean.",
    );
  });

  it("omits last_output fields when no matching hoglet output exists", () => {
    const base = makeHogletState();
    const prompt = renderPrompt([
      {
        ...base,
        ...deriveHogletLastOutput(base, [
          makeMessage({ sourceTaskId: "other-task" }),
        ]),
      },
    ]);

    expect(prompt).not.toContain("last_output_at:");
    expect(prompt).not.toContain("last_output_kind:");
    expect(prompt).not.toContain("last_output_preview:");
  });

  it("does not surface stale output from before the current run", () => {
    const base = makeHogletState({
      latestRunCreatedAt: "2026-05-18T17:10:00.000Z",
    });
    const prompt = renderPrompt([
      {
        ...base,
        ...deriveHogletLastOutput(base, [
          makeMessage({ createdAt: "2026-05-18T17:09:59.000Z" }),
        ]),
      },
    ]);

    expect(prompt).not.toContain("last_output_at:");
  });

  it("uses the newest matching hoglet output after the current run", () => {
    const base = makeHogletState({
      latestRunCreatedAt: "2026-05-18T17:10:00.000Z",
    });
    const prompt = renderPrompt([
      {
        ...base,
        ...deriveHogletLastOutput(base, [
          makeMessage({
            id: "message-old",
            body: "First report.",
            createdAt: "2026-05-18T17:20:00.000Z",
          }),
          makeMessage({
            id: "message-new",
            body: "Second report is the one to evaluate.",
            createdAt: "2026-05-18T17:35:00.000Z",
          }),
        ]),
      },
    ]);

    expect(prompt).toContain("last_output_at: 2026-05-18T17:35:00.000Z");
    expect(prompt).toContain(
      "last_output_preview: Second report is the one to evaluate.",
    );
    expect(prompt).not.toContain("last_output_preview: First report.");
  });

  it("attributes chat-tail messages to the source hoglet when possible", () => {
    const base = makeHogletState();
    const prompt = renderPrompt(
      [base],
      [
        makeMessage({
          body: "Verification complete.",
          sourceTaskId: "task-1",
        }),
        makeMessage({
          id: "message-2",
          body: "Holding tick.",
          kind: "hedgehog_message",
          sourceTaskId: null,
          createdAt: "2026-05-18T17:28:11.000Z",
        }),
      ],
    );

    expect(prompt).toContain(
      "[2026-05-18T17:27:04.000Z] hoglet=Jovan tool_result: Verification complete.",
    );
    expect(prompt).toContain(
      "[2026-05-18T17:28:11.000Z] hedgehog_message: Holding tick.",
    );
  });

  it("collapses newlines and truncates the last output preview", () => {
    const base = makeHogletState();
    const body = `Line one\n${"a".repeat(260)}`;
    const prompt = renderPrompt([
      {
        ...base,
        ...deriveHogletLastOutput(base, [makeMessage({ body })]),
      },
    ]);
    const previewLine = prompt
      .split("\n")
      .find((line) => line.includes("last_output_preview:"));

    expect(previewLine).toBeDefined();
    expect(previewLine).toContain("Line one ");
    expect(previewLine).toContain("… (truncated)");
    expect(previewLine).not.toContain("\n");
  });
});

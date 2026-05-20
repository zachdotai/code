import { describe, expect, it, vi } from "vitest";
import type { AnthropicToolUseBlock } from "../../llm-gateway/schemas";
import type { CloudTaskClient } from "../cloud-task-client";
import type { FeedbackRoutingService } from "../feedback-routing-service";
import type { HogletService } from "../hoglet-service";
import type { NestService } from "../nest-service";
import type { PrGraphService } from "../pr-graph-service";
import type { Nest } from "../schemas";
import { holdHandler } from "./hold-handler";
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

function makeContext(): TickContext {
  return {
    nest: makeNest(),
    hoglets: [],
    budget: new TickBudget(),
    prDependencies: [],
    loadout: {},
    nestAnomalies: {},
    repositoryContext: {
      repositories: ["org/repo"],
      primaryRepository: "org/repo",
      availableRepositories: ["org/repo"],
    },
    operatorDecisions: [],
  };
}

function makeDeps(): {
  deps: HedgehogToolDeps;
  writeNestMessage: ReturnType<typeof vi.fn>;
} {
  const writeNestMessage = vi.fn();
  return {
    deps: {
      cloudTasks: {} as CloudTaskClient,
      prGraph: {} as PrGraphService,
      feedbackRouting: {} as FeedbackRoutingService,
      hogletService: {} as HogletService,
      nestService: {} as NestService,
      writeNestMessage,
    },
    writeNestMessage,
  };
}

function block(input: Record<string, unknown>): AnthropicToolUseBlock {
  return { id: "block-1", name: "hold", input };
}

describe("holdHandler", () => {
  it("writes one detail audit row and returns a terminal hold result", async () => {
    const { deps, writeNestMessage } = makeDeps();

    const result = await holdHandler.handle(
      makeContext(),
      block({
        reason: "waiting for queued hoglet probes to be read",
        nextTrigger: "hoglet_output",
      }),
      deps,
    );

    expect(result).toMatchObject({
      success: true,
      stopDispatch: true,
      hold: {
        reason: "waiting for queued hoglet probes to be read",
        nextTrigger: "hoglet_output",
      },
    });
    expect(writeNestMessage).toHaveBeenCalledTimes(1);
    expect(writeNestMessage).toHaveBeenCalledWith(
      "nest-1",
      expect.objectContaining({
        kind: "audit",
        visibility: "detail",
        payloadJson: expect.objectContaining({
          type: "hedgehog_hold",
          nextTrigger: "hoglet_output",
        }),
      }),
    );
  });
});

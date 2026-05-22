import { describe, expect, it } from "vitest";
import {
  MAX_SPAWN_CALLS_PER_TICK,
  spawnHogletHandler,
} from "./spawn-hoglet-handler";
import {
  makeContext,
  makeHoglet,
  makeMockDeps,
  makeNest,
  makeToolBlock,
} from "./test-helpers";

describe("spawnHogletHandler", () => {
  it("spawns into the nest's primary repository when the tool call omits one", async () => {
    const { deps, hogletService, writeNestMessage } = makeMockDeps();
    hogletService.spawnInNest.mockResolvedValue({
      hoglet: makeHoglet({ id: "hoglet-new", taskId: "task-new" }),
      taskRunId: "run-new",
    });

    const result = await spawnHogletHandler.handle(
      makeContext(),
      makeToolBlock("spawn_hoglet", { prompt: "investigate flaky test" }),
      deps,
    );

    expect(result.success).toBe(true);
    expect(hogletService.spawnInNest).toHaveBeenCalledWith(
      expect.objectContaining({
        nestId: "nest-1",
        prompt: "investigate flaky test",
        repository: "org/repo",
      }),
      expect.anything(),
    );
    expect(writeNestMessage).toHaveBeenCalledWith(
      "nest-1",
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          type: "spawned_hoglet",
          repository: "org/repo",
          repositorySource: "nest_primary",
        }),
      }),
    );
  });

  it("caps spawns per tick once MAX_SPAWN_CALLS_PER_TICK is reached", async () => {
    const ctx = makeContext();
    ctx.budget.spawnCount = MAX_SPAWN_CALLS_PER_TICK;
    const { deps, hogletService, writeNestMessage } = makeMockDeps();

    const result = await spawnHogletHandler.handle(
      ctx,
      makeToolBlock("spawn_hoglet", { prompt: "another one" }),
      deps,
    );

    expect(result.success).toBe(false);
    expect(result.scratchpadSummary).toContain("capped");
    expect(hogletService.spawnInNest).not.toHaveBeenCalled();
    expect(writeNestMessage).toHaveBeenCalledWith(
      "nest-1",
      expect.objectContaining({
        payloadJson: expect.objectContaining({ type: "spawn_capped" }),
      }),
    );
  });

  it("refuses spawn when the supplied repository is not in available_repositories", async () => {
    const { deps, hogletService } = makeMockDeps();

    const result = await spawnHogletHandler.handle(
      makeContext(),
      makeToolBlock("spawn_hoglet", {
        prompt: "do thing",
        repository: "outsider/foo",
      }),
      deps,
    );

    expect(result.success).toBe(false);
    expect(result.scratchpadSummary).toContain("validation failed");
    expect(hogletService.spawnInNest).not.toHaveBeenCalled();
  });

  it("refuses spawn when no repository can be resolved", async () => {
    const ctx = makeContext({
      nest: makeNest({ primaryRepository: null }),
      availableRepositories: [],
      primaryRepository: null,
    });
    const { deps, hogletService, writeNestMessage } = makeMockDeps();

    const result = await spawnHogletHandler.handle(
      ctx,
      makeToolBlock("spawn_hoglet", { prompt: "do thing" }),
      deps,
    );

    expect(result.success).toBe(false);
    expect(result.scratchpadSummary).toContain("no repository resolvable");
    expect(hogletService.spawnInNest).not.toHaveBeenCalled();
    expect(writeNestMessage).toHaveBeenCalledWith(
      "nest-1",
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          type: "spawn_missing_repository",
        }),
      }),
    );
  });

  it("records spawn_failed when hogletService throws", async () => {
    const { deps, hogletService, writeNestMessage } = makeMockDeps();
    hogletService.spawnInNest.mockRejectedValue(new Error("agent server down"));

    const result = await spawnHogletHandler.handle(
      makeContext(),
      makeToolBlock("spawn_hoglet", { prompt: "do thing" }),
      deps,
    );

    expect(result.success).toBe(false);
    expect(result.scratchpadSummary).toContain("spawn_hoglet errored");
    expect(writeNestMessage).toHaveBeenCalledWith(
      "nest-1",
      expect.objectContaining({
        payloadJson: expect.objectContaining({ type: "spawn_failed" }),
      }),
    );
  });
});

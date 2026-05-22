import { describe, expect, it } from "vitest";
import { requestRepositoryAccessHandler } from "./request-repository-access-handler";
import { makeContext, makeMockDeps, makeToolBlock } from "./test-helpers";

describe("requestRepositoryAccessHandler", () => {
  it("grants access when the operator's GitHub integration covers the repo", async () => {
    const { deps, cloudTasks, writeNestMessage } = makeMockDeps();
    cloudTasks.resolveGithubUserIntegration.mockResolvedValue("integration-7");

    const result = await requestRepositoryAccessHandler.handle(
      makeContext(),
      makeToolBlock("request_repository_access", {
        repository: "org/new-repo",
        reason: "needs db schema work",
      }),
      deps,
    );

    expect(result.success).toBe(true);
    expect(result.scratchpadSummary).toContain("Granted access");
    expect(cloudTasks.resolveGithubUserIntegration).toHaveBeenCalledWith(
      "org/new-repo",
    );
    expect(writeNestMessage).toHaveBeenCalledWith(
      "nest-1",
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          type: "repository_access_granted",
          repository: "org/new-repo",
          integrationId: "integration-7",
        }),
      }),
    );
  });

  it("denies access when the integration doesn't cover the repo", async () => {
    const { deps, cloudTasks, writeNestMessage } = makeMockDeps();
    cloudTasks.resolveGithubUserIntegration.mockResolvedValue(null);

    const result = await requestRepositoryAccessHandler.handle(
      makeContext(),
      makeToolBlock("request_repository_access", {
        repository: "other/locked",
        reason: "wishful thinking",
      }),
      deps,
    );

    expect(result.success).toBe(false);
    expect(result.scratchpadSummary).toContain("denied");
    expect(writeNestMessage).toHaveBeenCalledWith(
      "nest-1",
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          type: "repository_access_denied",
          repository: "other/locked",
        }),
      }),
    );
  });

  it("surfaces resolver errors as a repository_access_error audit", async () => {
    const { deps, cloudTasks, writeNestMessage } = makeMockDeps();
    cloudTasks.resolveGithubUserIntegration.mockRejectedValue(
      new Error("github api 500"),
    );

    const result = await requestRepositoryAccessHandler.handle(
      makeContext(),
      makeToolBlock("request_repository_access", {
        repository: "org/repo",
        reason: "needed",
      }),
      deps,
    );

    expect(result.success).toBe(false);
    expect(result.scratchpadSummary).toContain(
      "request_repository_access errored",
    );
    expect(writeNestMessage).toHaveBeenCalledWith(
      "nest-1",
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          type: "repository_access_error",
          repository: "org/repo",
        }),
      }),
    );
  });

  it("rejects an empty repository slug as a validation error", async () => {
    const { deps, cloudTasks } = makeMockDeps();

    const result = await requestRepositoryAccessHandler.handle(
      makeContext(),
      makeToolBlock("request_repository_access", {
        repository: "",
        reason: "n/a",
      }),
      deps,
    );

    expect(result.success).toBe(false);
    expect(result.scratchpadSummary).toContain("validation failed");
    expect(cloudTasks.resolveGithubUserIntegration).not.toHaveBeenCalled();
  });
});

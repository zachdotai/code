import { describe, expect, it } from "vitest";
import { markValidatedHandler } from "./mark-validated-handler";
import { makeContext, makeMockDeps, makeToolBlock } from "./test-helpers";

describe("markValidatedHandler", () => {
  it("calls nestService.markValidated with parsed args and stops dispatch", async () => {
    const { deps, nestService } = makeMockDeps();

    const result = await markValidatedHandler.handle(
      makeContext(),
      makeToolBlock("mark_validated", {
        summary: "Goal met across all hoglets",
        pr_urls: ["https://github.com/org/repo/pull/1"],
        task_ids: ["task-a", "task-b"],
        caveats: ["Manual smoke pending"],
      }),
      deps,
    );

    expect(result).toMatchObject({
      success: true,
      stopDispatch: true,
      scratchpadSummary: "Marked nest validated",
    });
    expect(nestService.markValidated).toHaveBeenCalledWith({
      id: "nest-1",
      summary: "Goal met across all hoglets",
      prUrls: ["https://github.com/org/repo/pull/1"],
      taskIds: ["task-a", "task-b"],
      caveats: ["Manual smoke pending"],
    });
  });

  it("returns a validation error and does not call the service on bad input", async () => {
    const { deps, nestService, writeNestMessage } = makeMockDeps();

    const result = await markValidatedHandler.handle(
      makeContext(),
      makeToolBlock("mark_validated", { summary: "" }),
      deps,
    );

    expect(result.success).toBe(false);
    expect(nestService.markValidated).not.toHaveBeenCalled();
    expect(writeNestMessage).toHaveBeenCalledWith(
      "nest-1",
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          type: "tool_validation_error",
          tool: "mark_validated",
        }),
      }),
    );
  });

  it("surfaces service errors as audit + failed result without stopDispatch", async () => {
    const { deps, nestService, writeNestMessage } = makeMockDeps();
    nestService.markValidated.mockImplementation(() => {
      throw new Error("nest already validated");
    });

    const result = await markValidatedHandler.handle(
      makeContext(),
      makeToolBlock("mark_validated", { summary: "Done" }),
      deps,
    );

    expect(result.success).toBe(false);
    expect(result.stopDispatch).toBeUndefined();
    expect(result.scratchpadSummary).toContain("mark_validated failed");
    expect(writeNestMessage).toHaveBeenCalledWith(
      "nest-1",
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          type: "mark_validated_failed",
          error: expect.stringContaining("nest already validated"),
        }),
      }),
    );
  });
});

import { ANALYTICS_EVENTS } from "@posthog/shared";
import { describe, expect, it } from "vitest";
import {
  buildBranchMismatchAnalyticsEvent,
  buildCheckoutBranchRequest,
  buildLinkBranchRequest,
  resolveBranchMismatchError,
} from "./branchMismatchBanner";

const context = {
  taskId: "task-1",
  linkedBranch: "feat/foo",
  currentBranch: "main",
  hasUncommittedChanges: true,
};

describe("buildBranchMismatchAnalyticsEvent", () => {
  it("builds the warning-shown event", () => {
    expect(buildBranchMismatchAnalyticsEvent("shown", context)).toEqual({
      event: ANALYTICS_EVENTS.BRANCH_MISMATCH_WARNING_SHOWN,
      properties: {
        task_id: "task-1",
        linked_branch: "feat/foo",
        current_branch: "main",
        has_uncommitted_changes: true,
      },
    });
  });

  it.each(["switch", "relink", "dismiss"] as const)(
    "builds the %s action event",
    (action) => {
      expect(buildBranchMismatchAnalyticsEvent(action, context)).toEqual({
        event: ANALYTICS_EVENTS.BRANCH_MISMATCH_ACTION,
        properties: {
          task_id: "task-1",
          action,
          linked_branch: "feat/foo",
          current_branch: "main",
        },
      });
    },
  );

  it("returns null without both branches", () => {
    expect(
      buildBranchMismatchAnalyticsEvent("dismiss", {
        ...context,
        linkedBranch: null,
      }),
    ).toBeNull();
  });
});

describe("buildCheckoutBranchRequest", () => {
  it("builds the request", () => {
    expect(buildCheckoutBranchRequest("/repo", "feat/foo")).toEqual({
      directoryPath: "/repo",
      branchName: "feat/foo",
    });
  });

  it("returns null without repo path", () => {
    expect(buildCheckoutBranchRequest(null, "feat/foo")).toBeNull();
  });

  it("returns null without linked branch", () => {
    expect(buildCheckoutBranchRequest("/repo", null)).toBeNull();
  });
});

describe("buildLinkBranchRequest", () => {
  it("builds the request", () => {
    expect(buildLinkBranchRequest("task-1", "main")).toEqual({
      taskId: "task-1",
      branchName: "main",
    });
  });

  it("returns null without a current branch", () => {
    expect(buildLinkBranchRequest("task-1", null)).toBeNull();
  });
});

describe("resolveBranchMismatchError", () => {
  it("uses the error message", () => {
    expect(
      resolveBranchMismatchError(new Error("dirty worktree"), "nope"),
    ).toBe("dirty worktree");
  });

  it.each([["oops"], [new Error("")]])("falls back for %s", (error) => {
    expect(resolveBranchMismatchError(error, "Failed to switch branch")).toBe(
      "Failed to switch branch",
    );
  });
});

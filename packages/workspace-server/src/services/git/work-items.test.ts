import { describe, expect, it } from "vitest";
import { derivePrWorkItems } from "./service";

/** Minimal `gh pr list --json …` row; spread to override per case. */
function ghPr(overrides: Record<string, unknown> = {}) {
  return {
    number: 100,
    title: "Some PR",
    url: "https://github.com/PostHog/code/pull/100",
    headRefName: "feat/x",
    headRefOid: "sha100",
    mergeable: "MERGEABLE",
    reviewDecision: "APPROVED",
    isDraft: false,
    statusCheckRollup: [],
    ...overrides,
  };
}

describe("derivePrWorkItems", () => {
  it("surfaces a review item when changes are requested", () => {
    const items = derivePrWorkItems([
      ghPr({ reviewDecision: "CHANGES_REQUESTED" }),
    ]);
    expect(items).toEqual([
      {
        kind: "review",
        prNumber: 100,
        title: "Some PR",
        url: "https://github.com/PostHog/code/pull/100",
        headRefName: "feat/x",
        headSha: "sha100",
      },
    ]);
  });

  it.each([
    ["a failing check conclusion", [{ conclusion: "FAILURE" }]],
    ["a timed-out check conclusion", [{ conclusion: "TIMED_OUT" }]],
    ["a failing status state", [{ state: "FAILURE" }]],
    ["an errored status state", [{ state: "ERROR" }]],
    ["lowercase values", [{ conclusion: "failure" }]],
  ])("surfaces a ci item for %s", (_label, statusCheckRollup) => {
    const items = derivePrWorkItems([ghPr({ statusCheckRollup })]);
    expect(items).toEqual([expect.objectContaining({ kind: "ci" })]);
  });

  it.each([
    ["pending", [{ state: "PENDING" }]],
    ["cancelled", [{ conclusion: "CANCELLED" }]],
    ["action_required", [{ conclusion: "ACTION_REQUIRED" }]],
    ["successful", [{ conclusion: "SUCCESS" }]],
    ["empty rollup", []],
  ])("ignores %s checks", (_label, statusCheckRollup) => {
    expect(derivePrWorkItems([ghPr({ statusCheckRollup })])).toEqual([]);
  });

  it("surfaces a conflict item when the PR is conflicting", () => {
    const items = derivePrWorkItems([ghPr({ mergeable: "CONFLICTING" })]);
    expect(items).toEqual([expect.objectContaining({ kind: "conflict" })]);
  });

  it("surfaces multiple items from a single PR", () => {
    const items = derivePrWorkItems([
      ghPr({
        reviewDecision: "CHANGES_REQUESTED",
        statusCheckRollup: [{ conclusion: "FAILURE" }],
        mergeable: "CONFLICTING",
      }),
    ]);
    expect(items.map((i) => i.kind)).toEqual(["review", "ci", "conflict"]);
  });

  it("yields nothing for a clean, approved PR", () => {
    expect(derivePrWorkItems([ghPr()])).toEqual([]);
  });

  it("suppresses review and ci on drafts but keeps conflict", () => {
    const items = derivePrWorkItems([
      ghPr({
        isDraft: true,
        reviewDecision: "CHANGES_REQUESTED",
        statusCheckRollup: [{ conclusion: "FAILURE" }],
        mergeable: "CONFLICTING",
      }),
    ]);
    expect(items.map((i) => i.kind)).toEqual(["conflict"]);
  });

  it("yields nothing for a draft with no conflict", () => {
    const items = derivePrWorkItems([
      ghPr({
        isDraft: true,
        reviewDecision: "CHANGES_REQUESTED",
        statusCheckRollup: [{ conclusion: "FAILURE" }],
      }),
    ]);
    expect(items).toEqual([]);
  });

  it("falls back to an empty headSha when headRefOid is absent", () => {
    const items = derivePrWorkItems([
      ghPr({ headRefOid: undefined, mergeable: "CONFLICTING" }),
    ]);
    expect(items[0]?.headSha).toBe("");
  });
});

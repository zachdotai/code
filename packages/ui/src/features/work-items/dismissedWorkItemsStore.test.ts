import type { PrWorkItem } from "@posthog/core/git/router-schemas";
import { beforeEach, describe, expect, it } from "vitest";
import {
  dismissedWorkItemKey,
  useDismissedWorkItemsStore,
} from "./dismissedWorkItemsStore";

const item: PrWorkItem = {
  kind: "ci",
  prNumber: 7,
  title: "Fix login",
  url: "https://github.com/posthog/code/pull/7",
  headRefName: "fix/login",
  headSha: "sha-a",
};

describe("dismissedWorkItemKey", () => {
  it("is commit-scoped — a new head SHA yields a different key", () => {
    const a = dismissedWorkItemKey("/repo", item);
    const b = dismissedWorkItemKey("/repo", { ...item, headSha: "sha-b" });
    expect(a).not.toBe(b);
  });

  it("distinguishes repo, pr number, and kind", () => {
    const base = dismissedWorkItemKey("/repo", item);
    expect(dismissedWorkItemKey("/other", item)).not.toBe(base);
    expect(dismissedWorkItemKey("/repo", { ...item, prNumber: 8 })).not.toBe(
      base,
    );
    expect(
      dismissedWorkItemKey("/repo", { ...item, kind: "conflict" }),
    ).not.toBe(base);
  });
});

describe("useDismissedWorkItemsStore", () => {
  beforeEach(() => {
    useDismissedWorkItemsStore.setState({ dismissedKeys: [] });
  });

  it("records a dismissal once (idempotent)", () => {
    const { dismiss } = useDismissedWorkItemsStore.getState();
    dismiss("k1");
    dismiss("k1");
    expect(useDismissedWorkItemsStore.getState().dismissedKeys).toEqual(["k1"]);
  });

  it("caps the list so commit-scoped keys can't grow unbounded", () => {
    const { dismiss } = useDismissedWorkItemsStore.getState();
    for (let i = 0; i < 550; i++) dismiss(`k${i}`);
    const keys = useDismissedWorkItemsStore.getState().dismissedKeys;
    expect(keys).toHaveLength(500);
    expect(keys).not.toContain("k0"); // oldest dropped
    expect(keys).toContain("k549"); // newest kept
  });
});

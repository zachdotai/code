import type { PrWorkItem } from "@posthog/core/git/router-schemas";
import { xmlToContent } from "@posthog/core/message-editor/content";
import { describe, expect, it } from "vitest";
import { buildWorkItemPrompt } from "./buildWorkItemPrompt";

const item: PrWorkItem = {
  kind: "review",
  prNumber: 2480,
  title: "Configurable base branch",
  url: "https://github.com/PostHog/code/pull/2480",
  headRefName: "feat/base-branch",
  headSha: "abc123",
};

describe("buildWorkItemPrompt", () => {
  it("embeds the PR as a github_pr chip that hydrates into a pill", () => {
    const content = xmlToContent(buildWorkItemPrompt(item));
    const chipSegment = content.segments.find((s) => s.type === "chip");
    expect(chipSegment).toEqual({
      type: "chip",
      chip: {
        type: "github_pr",
        id: item.url,
        label: "#2480 - Configurable base branch",
      },
    });
  });

  it("includes the kind instruction and branch hint", () => {
    const xml = buildWorkItemPrompt(item);
    expect(xml).toContain("Address the requested review changes");
    expect(xml).toContain("Branch: feat/base-branch");
  });
});

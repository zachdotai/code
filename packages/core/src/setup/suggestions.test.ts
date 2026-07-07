import type { SpendAnalysisResponse } from "@posthog/core/billing/spendAnalysisTypes";
import {
  AI_USAGE_MIN_SPEND_USD,
  buildAiUsageSuggestion,
  buildPosthogSetupSuggestion,
  buildSdkHealthSuggestion,
  buildStaleFlagSuggestion,
  type StaleFlagPayload,
} from "@posthog/core/setup/suggestions";
import { describe, expect, it } from "vitest";

describe("buildStaleFlagSuggestion", () => {
  const flag: StaleFlagPayload = {
    flagKey: "old-checkout",
    referenceCount: 3,
    references: [
      { file: "src/a.ts", line: 10, method: "isFeatureEnabled" },
      { file: "src/b.ts", line: 22, method: "useFeatureFlag" },
    ],
  };

  it("derives a stable id from the flag key so dismissal sticks", () => {
    expect(buildStaleFlagSuggestion(flag).id).toBe(
      "posthog-stale-flag-old-checkout",
    );
  });

  it("anchors file/lineHint to the first reference", () => {
    const task = buildStaleFlagSuggestion(flag);
    expect(task.file).toBe("src/a.ts");
    expect(task.lineHint).toBe(10);
  });

  it("lists references and a '…and N more' tail when truncated", () => {
    const recommendation = buildStaleFlagSuggestion(flag).recommendation ?? "";
    expect(recommendation).toContain("- src/a.ts:10 (isFeatureEnabled)");
    expect(recommendation).toContain("- src/b.ts:22 (useFeatureFlag)");
    // referenceCount 3 with 2 shown → 1 more
    expect(recommendation).toContain("…and 1 more.");
  });

  it("omits the truncation tail when all references are shown", () => {
    const task = buildStaleFlagSuggestion({ ...flag, referenceCount: 2 });
    expect(task.recommendation).not.toContain("more.");
  });

  it("singularizes the reference count in the description", () => {
    const task = buildStaleFlagSuggestion({
      flagKey: "f",
      referenceCount: 1,
      references: [{ file: "x.ts", line: 1, method: "m" }],
    });
    expect(task.description).toContain("referenced in 1 place ");
  });
});

describe("buildSdkHealthSuggestion", () => {
  it("is a stable enricher posthog_setup suggestion", () => {
    const task = buildSdkHealthSuggestion();
    expect(task).toMatchObject({
      id: "posthog-sdk-health",
      source: "enricher",
      category: "posthog_setup",
      prompt: "/diagnosing-sdk-health",
    });
  });
});

describe("buildAiUsageSuggestion", () => {
  function makeSpend(
    overrides: Partial<SpendAnalysisResponse["summary"]> = {},
    topTool?: Partial<SpendAnalysisResponse["by_tool"]["items"][number]>,
  ): SpendAnalysisResponse {
    return {
      summary: {
        date_from: "2026-06-07T00:00:00Z",
        date_to: "2026-07-07T00:00:00Z",
        product: null,
        total_cost_usd: 120,
        event_count: 5000,
        scoped_cost_usd: 90,
        scoped_event_count: 4000,
        ...overrides,
      },
      by_product: { items: [], truncated: false },
      by_tool: {
        items: topTool
          ? [
              {
                tool: "Bash",
                generation_count: 900,
                cost_usd: 45,
                share_of_scoped: 0.5,
                avg_input_tokens: 42_000,
                ...topTool,
              },
            ]
          : [],
        truncated: false,
      },
      by_model: { items: [], truncated: false },
    };
  }

  it("returns null below the minimum spend threshold", () => {
    const data = makeSpend({ scoped_cost_usd: AI_USAGE_MIN_SPEND_USD - 1 });
    expect(buildAiUsageSuggestion(data)).toBeNull();
  });

  it("has a stable id so dismissal sticks across re-runs", () => {
    expect(buildAiUsageSuggestion(makeSpend())?.id).toBe(
      "ai-usage-optimization",
    );
  });

  it("summarizes spend and window in the description", () => {
    const task = buildAiUsageSuggestion(makeSpend());
    expect(task?.description).toContain("$90.00");
    expect(task?.description).toContain("30 days");
  });

  it("calls out the top tool when it dominates spend", () => {
    const task = buildAiUsageSuggestion(makeSpend({}, {}));
    expect(task?.description).toContain("Bash alone drives 50%");
    expect(task?.description).toContain("42k input tokens per call");
  });

  it("omits the hotspot line when no tool dominates", () => {
    const task = buildAiUsageSuggestion(
      makeSpend({}, { share_of_scoped: 0.2 }),
    );
    expect(task?.description).not.toContain("alone drives");
  });
});

describe("buildPosthogSetupSuggestion", () => {
  it("returns the install suggestion when not installed", () => {
    const task = buildPosthogSetupSuggestion("not_installed");
    expect(task.id).toBe("posthog-setup");
    expect(task.prompt).toBe("/instrument-integration");
  });

  it("returns the finish-init suggestion when installed but not initialized", () => {
    const task = buildPosthogSetupSuggestion("installed_no_init");
    expect(task.id).toBe("posthog-finish-init");
    expect(task.prompt).toContain("skip install steps");
  });
});

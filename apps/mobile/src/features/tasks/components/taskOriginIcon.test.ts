import { describe, expect, it } from "vitest";
import { getTaskOriginIcon } from "./taskOriginIcon";

describe("getTaskOriginIcon", () => {
  it.each([
    ["slack", "Slack"],
    ["signal_report", "Signals"],
    ["signals_scout", "Signals scout"],
    ["support_queue", "Support"],
    ["session_summaries", "Session summary"],
    ["error_tracking", "Error tracking"],
    ["eval_clusters", "Evals"],
    ["automation", "Automation"],
  ])("maps %s to an icon labelled %s", (origin, label) => {
    const meta = getTaskOriginIcon(origin);
    expect(meta?.label).toBe(label);
    expect(meta?.Icon).toBeTruthy();
  });

  it.each([["user_created"], ["code"], ["unknown"]])(
    "returns undefined for %s",
    (origin) => {
      expect(getTaskOriginIcon(origin)).toBeUndefined();
    },
  );

  it("returns undefined when no origin is given", () => {
    expect(getTaskOriginIcon()).toBeUndefined();
  });
});

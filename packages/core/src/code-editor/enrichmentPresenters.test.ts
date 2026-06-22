import { describe, expect, it } from "vitest";
import { formatPercentDelta } from "./enrichmentPresenters";

describe("formatPercentDelta", () => {
  it("returns null when there is no delta (absent / no baseline)", () => {
    expect(formatPercentDelta(null)).toBeNull();
    expect(formatPercentDelta(undefined)).toBeNull();
  });

  it("signs and rounds a meaningful delta", () => {
    expect(formatPercentDelta(186.2)).toBe("+186%");
    expect(formatPercentDelta(-5.2)).toBe("-5%");
    expect(formatPercentDelta(1.43)).toBe("+1%");
    expect(formatPercentDelta(-0.9)).toBe("-1%");
  });

  it("hides sub-1% noise rather than rendering a meaningless +0%/-0%", () => {
    expect(formatPercentDelta(0)).toBeNull();
    expect(formatPercentDelta(0.4)).toBeNull();
    expect(formatPercentDelta(-0.4)).toBeNull();
  });
});

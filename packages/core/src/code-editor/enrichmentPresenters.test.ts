import { describe, expect, it } from "vitest";
import { formatPercentDelta } from "./enrichmentPresenters";

describe("formatPercentDelta", () => {
  it.each([null, undefined])(
    "returns null when there is no delta (absent / no baseline): %s",
    (input) => {
      expect(formatPercentDelta(input)).toBeNull();
    },
  );

  it.each([
    [186.2, "+186%"],
    [-5.2, "-5%"],
    [1.43, "+1%"],
    [-0.9, "-1%"],
  ] as const)("signs and rounds %s → %s", (input, expected) => {
    expect(formatPercentDelta(input)).toBe(expected);
  });

  it.each([0, 0.4, -0.4])(
    "hides sub-1%% noise rather than rendering a meaningless +0%%/-0%%: %s",
    (input) => {
      expect(formatPercentDelta(input)).toBeNull();
    },
  );
});

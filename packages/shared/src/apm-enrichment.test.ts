import { describe, expect, it } from "vitest";
import { formatMs, formatPercentDelta } from "./apm-enrichment";

describe("formatMs", () => {
  it.each([
    [0, "0ms"],
    // Sub-0.05ms rounds to "0ms" — acceptable for latency display (a function
    // this fast isn't what APM surfaces); pinned so the rounding is intentional.
    [0.03, "0ms"],
    [1.5, "1.5ms"],
    [7, "7ms"],
    [9.94, "9.9ms"],
    [10, "10ms"],
    [13.4, "13ms"],
    [726.6, "727ms"],
  ])("formats %dms as %s", (ms, expected) => {
    expect(formatMs(ms)).toBe(expected);
  });
});

describe("formatPercentDelta", () => {
  const cases: Array<[number | null | undefined, string | null]> = [
    [null, null], // no baseline
    [undefined, null],
    [0.4, null], // sub-1% noise suppressed (avoids +0% / -0%)
    [-0.4, null],
    [0.5, "+1%"], // equal-magnitude deltas round symmetrically (no -0 suppression)
    [-0.5, "-1%"],
    [186.2, "+186%"],
    [-5.2, "-5%"],
    [Number.NaN, null], // non-finite guarded
    [Number.POSITIVE_INFINITY, null],
    [Number.NEGATIVE_INFINITY, null],
  ];
  it.each(cases)("formatPercentDelta(%p) → %p", (input, expected) => {
    expect(formatPercentDelta(input)).toBe(expected);
  });
});

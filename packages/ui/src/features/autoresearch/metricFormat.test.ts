import type { AutoresearchIteration } from "@posthog/core/autoresearch/schemas";
import { describe, expect, it } from "vitest";
import { computeChartLayout } from "./chartLayout";
import { deltaTone, formatChartValue, formatMetricDelta } from "./metricFormat";

describe("deltaTone", () => {
  it.each([
    [null, "minimize", "neutral"],
    [0, "minimize", "neutral"],
    [-10, "minimize", "improved"],
    [10, "minimize", "worsened"],
    [10, "maximize", "improved"],
    [-10, "maximize", "worsened"],
  ] as const)("delta %s under %s is %s", (delta, direction, expected) => {
    expect(deltaTone(delta, direction)).toBe(expected);
  });
});

describe("formatMetricDelta", () => {
  it.each([
    [null, "kB", "—"],
    [10.5, "kB", "+10.5 kB"],
    [-3, null, "-3"],
    [2, "%", "+2%"],
  ])("formats %s with unit %s as %s", (delta, unit, expected) => {
    expect(formatMetricDelta(delta, unit)).toBe(expected);
  });
});

describe("formatChartValue", () => {
  it.each([
    [1234.56, "1,235"],
    [999.456, "999.46"],
    [-1500.4, "-1,500"],
  ])("formats %s as %s", (value, expected) => {
    expect(formatChartValue(value)).toBe(expected);
  });
});

describe("computeChartLayout", () => {
  const options = {
    width: 100,
    height: 100,
    padding: { top: 10, right: 10, bottom: 10, left: 10 },
  };

  function iteration(
    overrides: Partial<AutoresearchIteration>,
  ): AutoresearchIteration {
    return {
      index: 1,
      value: 0,
      bestValue: 0,
      delta: null,
      summary: null,
      at: 0,
      ...overrides,
    };
  }

  it("returns null without iterations", () => {
    expect(computeChartLayout([], null, options)).toBeNull();
  });

  it("centers a single iteration and spans the value range", () => {
    const layout = computeChartLayout(
      [iteration({ value: 5, bestValue: 5 })],
      null,
      options,
    );
    expect(layout).not.toBeNull();
    // Lone point sits mid-chart; equal min/max pad out to a 2-unit span
    // plus the 5% fudge on each side.
    expect(layout?.x(0)).toBe(50);
    expect(layout?.min).toBeCloseTo(3.9);
    expect(layout?.max).toBeCloseTo(6.1);
    expect(layout?.targetY).toBeNull();
  });

  it("includes the target in the scale and reports its y", () => {
    const layout = computeChartLayout(
      [
        iteration({ index: 1, value: 10, bestValue: 10 }),
        iteration({ index: 2, value: 20, bestValue: 10 }),
      ],
      40,
      options,
    );
    expect(layout).not.toBeNull();
    if (!layout) return;
    expect(layout.max).toBeGreaterThan(40);
    expect(layout.targetY).toBeCloseTo(layout.y(40));
    expect(layout.valuePath.split(" ")).toHaveLength(2);
  });
});

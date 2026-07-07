import type { AutoresearchIteration } from "@posthog/core/autoresearch/schemas";

export interface ChartLayoutOptions {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
}

export interface ChartLayout {
  x: (index: number) => number;
  y: (value: number) => number;
  min: number;
  max: number;
  valuePath: string;
  bestPath: string;
  targetY: number | null;
}

/**
 * Shared geometry for the iteration metric chart. The live `MetricChart` and
 * the report export render the same layout at different sizes, so the scale
 * and path math lives once here — if it changed in only one of them, the
 * exported chart would silently disagree with the on-screen one.
 */
export function computeChartLayout(
  iterations: AutoresearchIteration[],
  targetValue: number | null,
  { width, height, padding }: ChartLayoutOptions,
): ChartLayout | null {
  if (iterations.length === 0) return null;

  const values = iterations.map((iteration) => iteration.value);
  const bests = iterations.map((iteration) => iteration.bestValue);
  const all = [...values, ...bests];
  if (targetValue !== null) all.push(targetValue);

  let min = Math.min(...all);
  let max = Math.max(...all);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  min -= span * 0.05;
  max += span * 0.05;

  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const x = (index: number) =>
    padding.left +
    (iterations.length === 1
      ? innerWidth / 2
      : (index / (iterations.length - 1)) * innerWidth);
  const y = (value: number) =>
    padding.top + ((max - value) / (max - min)) * innerHeight;

  return {
    x,
    y,
    min,
    max,
    valuePath: iterations
      .map((iteration, i) => `${x(i)},${y(iteration.value)}`)
      .join(" "),
    bestPath: iterations
      .map((iteration, i) => `${x(i)},${y(iteration.bestValue)}`)
      .join(" "),
    targetY: targetValue === null ? null : y(targetValue),
  };
}

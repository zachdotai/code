import { APM_STATS_WINDOW, type SpanLineStat } from "@posthog/shared";
import { describe, expect, it } from "vitest";
import { formatApmInlineComments } from "./apm-comment-formatter.js";

function stat(overrides: Partial<SpanLineStat>): SpanLineStat {
  return {
    line: 1,
    count: 100,
    errorCount: 0,
    p50Ms: 1,
    p95Ms: 2,
    ...overrides,
  };
}

describe("formatApmInlineComments", () => {
  const src = ["fn a() {}", "fn b() {}", "fn c() {}"].join("\n");
  const FILE = "rust/feature-flags/src/flags/flag_matching.rs";

  it("appends an APM suffix to the line the stat points at (1-based)", () => {
    const out = formatApmInlineComments(
      src,
      "rust",
      [stat({ line: 2, p95Ms: 4.8 })],
      FILE,
    );
    const lines = out.split("\n");
    expect(lines[0]).toBe("fn a() {}");
    expect(lines[1]).toContain("fn b() {}");
    expect(lines[1]).toContain("[PostHog] APM");
    expect(lines[1]).toContain("4.8");
    expect(lines[2]).toBe("fn c() {}");
  });

  it("includes a self-contained, line-specific query-apm-spans drill-in hint", () => {
    const out = formatApmInlineComments(src, "rust", [stat({ line: 2 })], FILE);
    const line = out.split("\n")[1];
    expect(line).toContain("query-apm-spans");
    expect(line).toContain(`code.filepath~"${FILE}"`);
    expect(line).toContain("code.lineno=2");
  });

  it("uses # comments for python/ruby", () => {
    const out = formatApmInlineComments(
      "def a():\n    pass",
      "python",
      [stat({ line: 1 })],
      "svc/main.py",
    );
    expect(out.split("\n")[0]).toMatch(/# \[PostHog\] APM/);
  });

  it("surfaces error count only when there are errors", () => {
    const withErr = formatApmInlineComments(
      src,
      "rust",
      [stat({ line: 1, errorCount: 3, count: 100 })],
      FILE,
    );
    expect(withErr.split("\n")[0]).toContain("3 errors");

    const noErr = formatApmInlineComments(
      src,
      "rust",
      [stat({ line: 1, errorCount: 0 })],
      FILE,
    );
    // "errors" must not appear; the hint uses no such word, so this is safe.
    expect(noErr.split("\n")[0]).not.toContain("errors");
  });

  it("ignores stats whose line is out of range", () => {
    expect(
      formatApmInlineComments(src, "rust", [stat({ line: 99 })], FILE),
    ).toBe(src);
  });

  it("promotes a count that rounds up to the next unit (no '1000.0k')", () => {
    const out = formatApmInlineComments(
      src,
      "rust",
      [stat({ line: 1, count: 999_999 })],
      FILE,
    );
    const line = out.split("\n")[0];
    expect(line).toContain("1.0M");
    expect(line).not.toContain("1000.0k");
  });

  it("includes p99 and the window-labelled span count", () => {
    const out = formatApmInlineComments(
      src,
      "rust",
      [stat({ line: 1, count: 26_200, p99Ms: 12 })],
      FILE,
    );
    const line = out.split("\n")[0];
    expect(line).toContain("p99 12ms");
    expect(line).toContain(`spans/${APM_STATS_WINDOW.short}`);
  });

  it("appends period-over-period deltas to the metrics that changed", () => {
    const out = formatApmInlineComments(
      src,
      "rust",
      [
        stat({
          line: 1,
          count: 1000,
          p50Ms: 1.5,
          p95Ms: 7,
          p99Ms: 13,
          p50PctChange: 12,
          p95PctChange: 180,
          p99PctChange: null,
          countPctChange: 40,
        }),
      ],
      FILE,
    );
    const line = out.split("\n")[0];
    expect(line).toContain("p50 1.5ms (+12%)");
    expect(line).toContain("p95 7ms (+180%)");
    expect(line).toContain(`spans/${APM_STATS_WINDOW.short} (+40%)`);
    // p99 had no baseline (null) → no delta token on it.
    expect(line).not.toContain("p99 13ms (");
  });

  it("keeps CRLF line endings intact (comment before the carriage return)", () => {
    const crlf = ["fn a() {}", "fn b() {}"].join("\r\n");
    const out = formatApmInlineComments(
      crlf,
      "rust",
      [stat({ line: 1 })],
      FILE,
    );
    const outLines = out.split("\r\n");
    expect(outLines).toHaveLength(2);
    expect(outLines[0]).toContain("[PostHog] APM");
    expect(outLines[0]).not.toContain("\r");
    expect(outLines[1]).toBe("fn b() {}");
  });
});

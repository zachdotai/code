import {
  APM_STATS_WINDOW,
  type SymbolStatsPeriod,
  type SymbolStatsRow,
} from "@posthog/shared";
import { describe, expect, it } from "vitest";
import {
  buildSymbolStatsQuery,
  mapSymbolStatsResults,
} from "./apm-breakdown.js";

describe("buildSymbolStatsQuery", () => {
  it("builds a line-mode query (no symbols) with the file path and default window", () => {
    const q = buildSymbolStatsQuery("src/flags/flag_matching.rs");
    expect(q.kind).toBe("TraceSpansSymbolStatsQuery");
    expect(q.filePath).toBe("src/flags/flag_matching.rs");
    expect(q.dateRange.date_from).toBe("-24h");
    expect(q.symbols).toBeUndefined();
  });

  it("includes symbols when supplied and honors a window override", () => {
    const q = buildSymbolStatsQuery("a/b.rs", {
      dateFrom: "-7d",
      symbols: [{ name: "f", startLine: 1, endLine: 9 }],
    });
    expect(q.dateRange.date_from).toBe("-7d");
    expect(q.symbols).toEqual([{ name: "f", startLine: 1, endLine: 9 }]);
  });

  it("defaults the window to the shared APM_STATS_WINDOW (single source)", () => {
    expect(buildSymbolStatsQuery("a.rs").dateRange.date_from).toBe(
      APM_STATS_WINDOW.dateFrom,
    );
  });

  it("treats an empty symbols array as line mode (omits symbols)", () => {
    expect(
      buildSymbolStatsQuery("a.rs", { symbols: [] }).symbols,
    ).toBeUndefined();
  });
});

function period(): SymbolStatsPeriod {
  return {
    count: 0,
    error_count: 0,
    sum_duration_nano: 0,
    p50_duration_nano: 0,
    p95_duration_nano: 0,
    p99_duration_nano: 0,
    busy_count: 0,
    p50_busy_nano: 0,
    p95_busy_nano: 0,
    p99_busy_nano: 0,
  };
}

function row(overrides: Partial<SymbolStatsRow>): SymbolStatsRow {
  return {
    ...period(),
    line: 0,
    count_pct_change: null,
    p50_duration_pct_change: null,
    p95_duration_pct_change: null,
    p99_duration_pct_change: null,
    error_rate_pct_change: null,
    ...overrides,
  };
}

describe("mapSymbolStatsResults", () => {
  it("maps rows to per-line stats, converting ns → ms", () => {
    const rows: SymbolStatsRow[] = [
      row({
        line: 459,
        count: 25941,
        error_count: 12,
        p50_duration_nano: 1_695_000,
        p95_duration_nano: 7_153_900,
      }),
    ];
    expect(mapSymbolStatsResults(rows)).toEqual([
      {
        line: 459,
        count: 25941,
        errorCount: 12,
        p50Ms: 1.695,
        p95Ms: 7.1539,
        p99Ms: 0,
        countPctChange: null,
        p50PctChange: null,
        p95PctChange: null,
        p99PctChange: null,
        errorRatePctChange: null,
      },
    ]);
  });

  it("passes the server's per-metric deltas straight through", () => {
    const [s] = mapSymbolStatsResults([
      row({
        line: 1,
        count_pct_change: 40,
        p50_duration_pct_change: 12,
        p95_duration_pct_change: 180,
        p99_duration_pct_change: -5,
        error_rate_pct_change: 100,
      }),
    ]);
    expect(s.countPctChange).toBe(40);
    expect(s.p50PctChange).toBe(12);
    expect(s.p95PctChange).toBe(180);
    expect(s.p99PctChange).toBe(-5);
    expect(s.errorRatePctChange).toBe(100);
  });

  it("preserves the server's line ordering", () => {
    const rows = [row({ line: 12 }), row({ line: 3 })];
    expect(mapSymbolStatsResults(rows).map((s) => s.line)).toEqual([12, 3]);
  });

  it("returns an empty array for no rows (the no-data path)", () => {
    expect(mapSymbolStatsResults([])).toEqual([]);
  });

  it("converts sub-millisecond durations (ns → ms)", () => {
    const [s] = mapSymbolStatsResults([
      row({ line: 1, p50_duration_nano: 500_000, p99_duration_nano: 30_000 }),
    ]);
    expect(s.p50Ms).toBe(0.5);
    expect(s.p99Ms).toBe(0.03);
  });
});

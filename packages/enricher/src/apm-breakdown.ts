import {
  APM_STATS_WINDOW,
  type SourceSymbol,
  type SpanLineStat,
  type SymbolStatsRow,
} from "@posthog/shared";

/**
 * Request body for `POST …/tracing/spans/symbol-stats/`. The server owns OTel
 * attribute resolution, path matching, and aggregation, so the client only names
 * the file; omit `symbols` for per-line stats, supply them for per-symbol rollup.
 */
export interface SymbolStatsQueryNode {
  kind: "TraceSpansSymbolStatsQuery";
  dateRange: { date_from: string };
  filePath: string;
  symbols?: SourceSymbol[];
}

interface BuildOptions {
  dateFrom?: string;
  symbols?: SourceSymbol[];
}

/**
 * Repo-relative `filePath` is suffix-matched server-side against the recorded
 * `code.file.path`. Defaults the window to `APM_STATS_WINDOW` (single source).
 */
export function buildSymbolStatsQuery(
  filePath: string,
  opts: BuildOptions = {},
): SymbolStatsQueryNode {
  const node: SymbolStatsQueryNode = {
    kind: "TraceSpansSymbolStatsQuery",
    dateRange: { date_from: opts.dateFrom ?? APM_STATS_WINDOW.dateFrom },
    filePath,
  };
  if (opts.symbols && opts.symbols.length > 0) {
    node.symbols = opts.symbols;
  }
  return node;
}

function nsToMs(ns: number): number {
  return ns / 1_000_000;
}

/** Server row → client shape; deltas are server-computed, not derived here. */
export function mapSymbolStatsResults(rows: SymbolStatsRow[]): SpanLineStat[] {
  return rows.map((r) => ({
    line: r.line,
    count: r.count,
    errorCount: r.error_count,
    p50Ms: nsToMs(r.p50_duration_nano),
    p95Ms: nsToMs(r.p95_duration_nano),
    p99Ms: nsToMs(r.p99_duration_nano),
    countPctChange: r.count_pct_change,
    p50PctChange: r.p50_duration_pct_change,
    p95PctChange: r.p95_duration_pct_change,
    p99PctChange: r.p99_duration_pct_change,
    errorRatePctChange: r.error_rate_pct_change,
  }));
}

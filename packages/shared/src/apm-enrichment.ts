// PostHog APM enrichment boundary types: per-line production-latency stats shown
// in the editor and agent comments. In @posthog/shared so both ui and
// workspace-server can import them without crossing layer boundaries.

import { getFileExtension } from "./path";

export interface SpanLineStat {
  /** 1-based line (the span's code.lineno). */
  line: number;
  count: number;
  errorCount: number;
  /** Latency in milliseconds. */
  p50Ms: number;
  p95Ms: number;
  p99Ms?: number;
  /** % change vs the previous equal window (180 = +180%); null when no baseline. */
  countPctChange?: number | null;
  p50PctChange?: number | null;
  p95PctChange?: number | null;
  p99PctChange?: number | null;
  errorRatePctChange?: number | null;
}

/** The forms of an APM stats window, all derived from one value like "24h". */
export interface ApmWindow {
  value: string;
  dateFrom: string;
  /** e.g. the "24h" in "spans/24h" */
  short: string;
  /** e.g. "last 24h" */
  label: string;
  /** e.g. "vs previous 24h" */
  comparisonLabel: string;
}

export function apmWindow(value: string): ApmWindow {
  return {
    value,
    dateFrom: `-${value}`,
    short: value,
    label: `last ${value}`,
    comparisonLabel: `vs previous ${value}`,
  };
}

/**
 * The window APM line stats use (editor + agent comments) — one source of truth:
 * change the value and the query window plus every label follow. 24h gives a
 * stable day-over-day comparison and returns in ~8s server-side. A future user
 * setting just calls `apmWindow(value)`.
 */
export const APM_STATS_WINDOW = apmWindow("24h");

export interface SerializedApmEnrichment {
  /** Repo-relative path these stats were matched against. */
  filePath: string;
  stats: SpanLineStat[];
  /** Deep link to the PostHog tracing explorer; built host-side. */
  tracingUrl: string;
}

/**
 * A source symbol (function) to request latency for, by declaration line range.
 * The client supplies these from its editor parse; the server attributes spans
 * to the smallest enclosing range. `name` is echoed back on the result row.
 */
export interface SourceSymbol {
  name?: string;
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
}

/** Aggregated metrics for one bucket over a single period. Durations in nanoseconds. */
export interface SymbolStatsPeriod {
  count: number;
  error_count: number;
  sum_duration_nano: number;
  p50_duration_nano: number;
  p95_duration_nano: number;
  p99_duration_nano: number;
  /** Spans with an active/busy-time attribute. 0 ⇒ busy_* are not meaningful. */
  busy_count: number;
  p50_busy_nano: number;
  p95_busy_nano: number;
  p99_busy_nano: number;
}

/**
 * One bucket of the symbol-stats response (line mode): a source line's current
 * period plus the server-computed % deltas vs the previous equal window
 * (180 = +180%; null when no baseline).
 */
export interface SymbolStatsRow extends SymbolStatsPeriod {
  line: number;
  count_pct_change: number | null;
  p50_duration_pct_change: number | null;
  p95_duration_pct_change: number | null;
  p99_duration_pct_change: number | null;
  error_rate_pct_change: number | null;
}

export type SymbolStatsGranularity = "line" | "symbol";

export function formatMs(ms: number): string {
  return ms < 10 ? `${Math.round(ms * 10) / 10}ms` : `${Math.round(ms)}ms`;
}

/**
 * Format a period-over-period % change ("+186%", "-5%"), or null when there's no
 * baseline or it rounds to sub-1% noise (avoids a meaningless "+0%" / "-0%").
 */
export function formatPercentDelta(
  pct: number | null | undefined,
): string | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  // Round half away from zero so equal-magnitude deltas render symmetrically:
  // Math.round sends -0.5 to -0 (suppressed) while +0.5 becomes +1 (shown).
  const rounded = pct < 0 ? -Math.round(-pct) : Math.round(pct);
  if (rounded === 0) return null;
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

/**
 * Single source of truth for which files get APM enrichment: lowercased ext →
 * comment-style language id. Broader than event/flag enrichment (e.g. `.rs`)
 * because APM joins on span attributes, not parsed SDK calls; the id only needs
 * to distinguish `#` from `//`.
 */
export const APM_LANG_BY_EXT: Record<string, string> = {
  ".rs": "rust",
  ".go": "go",
  ".py": "python",
  ".rb": "ruby",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".cs": "csharp",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".c": "c",
  ".h": "c",
  ".hpp": "cpp",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".php": "php",
  ".scala": "scala",
  ".swift": "swift",
};

/** The lowercased file extension (with leading dot), or `null` if none. */
export function fileExtension(filePath: string): string | null {
  const ext = getFileExtension(filePath);
  return ext ? `.${ext}` : null;
}

/** The APM comment-style language id for a file, or `null` if not eligible. */
export function apmLangForFile(filePath: string): string | null {
  const ext = fileExtension(filePath);
  return ext ? (APM_LANG_BY_EXT[ext] ?? null) : null;
}

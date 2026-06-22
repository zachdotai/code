import {
  formatMs,
  type SerializedApmEnrichment,
  type SpanLineStat,
} from "@posthog/shared";

export interface ApmLineMarker {
  /** 1-based line number (span code.lineno is already 1-based — no offset). */
  line: number;
  /** The underlying per-line stats, surfaced in the popover. */
  stat: SpanLineStat;
  /** Single-line tooltip summary shown on gutter hover. */
  summary: string;
}

function summarize(stat: SpanLineStat): string {
  const parts = [
    `p95 ${formatMs(stat.p95Ms)}`,
    `p50 ${formatMs(stat.p50Ms)}`,
    `${stat.count} spans`,
  ];
  if (stat.errorCount > 0) parts.push(`${stat.errorCount} err`);
  return parts.join(" · ");
}

/**
 * Build per-line gutter markers from APM enrichment. Each instrumented line gets
 * one presence marker; the gutter renders a single fixed colour ("PostHog has
 * data on this line") rather than a severity gradient — latency has no inherent
 * good/bad without a threshold, so the numbers live in the popover instead.
 */
export function buildApmLineMarkers(
  enrichment: SerializedApmEnrichment | null,
): ApmLineMarker[] {
  if (!enrichment || enrichment.stats.length === 0) return [];

  return enrichment.stats.map((stat) => ({
    line: stat.line,
    stat,
    summary: summarize(stat),
  }));
}

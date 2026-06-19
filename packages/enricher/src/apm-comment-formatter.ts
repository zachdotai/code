import {
  APM_STATS_WINDOW,
  formatMs,
  formatPercentDelta,
  type SpanLineStat,
} from "@posthog/shared";
import { commentPrefix } from "./comment-style.js";

function formatCount(n: number): string {
  if (n < 1_000) return String(n);
  // Promote to the next unit when rounding to one decimal would otherwise
  // overflow it: 999_999 must read "1.0M", not "1000.0k".
  if (n < 999_950) return `${(n / 1_000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function withDelta(label: string, pct: number | null | undefined): string {
  const delta = formatPercentDelta(pct);
  return delta ? `${label} (${delta})` : label;
}

function formatApmComment(s: SpanLineStat, filePath: string): string {
  const parts = [
    "APM",
    withDelta(`p50 ${formatMs(s.p50Ms)}`, s.p50PctChange),
    withDelta(`p95 ${formatMs(s.p95Ms)}`, s.p95PctChange),
  ];
  if (s.p99Ms != null) {
    parts.push(withDelta(`p99 ${formatMs(s.p99Ms)}`, s.p99PctChange));
  }
  parts.push(
    withDelta(
      `${formatCount(s.count)} spans/${APM_STATS_WINDOW.short}`,
      s.countPctChange,
    ),
  );
  if (s.errorCount > 0) {
    parts.push(withDelta(`${s.errorCount} errors`, s.errorRatePctChange));
  }
  // Self-contained drill-in: the agent reads file windows, not the whole file,
  // so the MCP query lives on each annotated line rather than in a file header.
  parts.push(
    `dig in: query-apm-spans code.filepath~"${filePath}" code.lineno=${s.line}`,
  );
  return parts.join(" — ");
}

/** Stat lines are 1-based (`code.lineno`); the source line array is 0-based. */
export function formatApmInlineComments(
  source: string,
  languageId: string,
  stats: SpanLineStat[],
  filePath: string,
): string {
  const prefix = commentPrefix(languageId);
  const lines = source.split("\n");

  const byLine = new Map<number, SpanLineStat[]>();
  for (const s of stats) {
    const idx = s.line - 1;
    if (idx < 0 || idx >= lines.length) continue;
    const list = byLine.get(idx) ?? [];
    list.push(s);
    byLine.set(idx, list);
  }

  for (const [idx, lineStats] of byLine) {
    const body = lineStats
      .map((s) => formatApmComment(s, filePath))
      .join(" | ");
    const line = lines[idx];
    // Keep a trailing CRLF intact: insert the suffix before the "\r" so the
    // carriage return stays at end-of-line instead of landing mid-comment.
    const cr = line.endsWith("\r") ? "\r" : "";
    const text = cr ? line.slice(0, -1) : line;
    lines[idx] = `${text} ${prefix} [PostHog] ${body}${cr}`;
  }

  return lines.join("\n");
}

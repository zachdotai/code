import {
  compactNumber,
  formatPercentDelta,
} from "@posthog/core/code-editor/enrichmentPresenters";
import { Badge, Card } from "@posthog/quill";
import { APM_STATS_WINDOW, formatMs, getFileName } from "@posthog/shared";
import { openExternalUrl } from "@posthog/ui/shell/openExternal";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useApmPopoverStore } from "../stores/apmPopoverStore";

const POPOVER_WIDTH = 280;
const GAP = 8;

function Metric({
  label,
  value,
  delta,
  worseWhenUp,
}: {
  label: string;
  value: string;
  /** % change vs the prior window; null/undefined hides it. */
  delta?: number | null;
  /** When true, an increase is bad (latency) → red up / green down. */
  worseWhenUp?: boolean;
}) {
  const deltaText = formatPercentDelta(delta);
  const deltaClass = worseWhenUp
    ? (delta ?? 0) > 0
      ? "text-(--red-11)"
      : "text-(--green-11)"
    : "text-muted-foreground";
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium font-mono">
        {value}
        {deltaText && (
          <span className={`ml-1 text-[10px] ${deltaClass}`}>{deltaText}</span>
        )}
      </div>
    </div>
  );
}

export function ApmEnrichmentPopover() {
  const open = useApmPopoverStore((s) => s.open);
  const marker = useApmPopoverStore((s) => s.marker);
  const anchorRect = useApmPopoverStore((s) => s.anchorRect);
  const filePath = useApmPopoverStore((s) => s.filePath);
  const tracingUrl = useApmPopoverStore((s) => s.tracingUrl);
  const close = useApmPopoverStore((s) => s.close);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  if (!open || !marker || !anchorRect) return null;

  const { stat } = marker;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const preferredLeft = anchorRect.right + GAP;
  const fitsRight = preferredLeft + POPOVER_WIDTH + 8 <= viewportWidth;
  const left = fitsRight
    ? preferredLeft
    : Math.max(8, anchorRect.left - POPOVER_WIDTH - GAP);
  const top = Math.max(8, Math.min(anchorRect.top, viewportHeight - 260));

  const errorRate = stat.count > 0 ? (stat.errorCount / stat.count) * 100 : 0;
  const file = filePath ? getFileName(filePath) : null;
  const hasDelta = [
    stat.p50PctChange,
    stat.p95PctChange,
    stat.p99PctChange,
    stat.countPctChange,
    stat.errorRatePctChange,
  ].some((d) => formatPercentDelta(d) != null);

  return createPortal(
    <div
      ref={ref}
      style={{
        position: "fixed",
        top,
        left,
        width: POPOVER_WIDTH,
        zIndex: 1000,
      }}
    >
      <Card size="sm" className="gap-0 py-0 shadow-lg">
        <div className="flex flex-col gap-2 px-3 py-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Badge variant="info">APM</Badge>
              <div className="min-w-0">
                <div className="font-medium text-sm">Production latency</div>
                <div className="truncate text-muted-foreground text-xs">
                  {APM_STATS_WINDOW.label} · PostHog tracing
                </div>
              </div>
            </div>
            {stat.errorCount > 0 && (
              <Badge variant="destructive">{stat.errorCount} err</Badge>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs">
            <Metric
              label="p50"
              value={formatMs(stat.p50Ms)}
              delta={stat.p50PctChange}
              worseWhenUp
            />
            <Metric
              label="p95"
              value={formatMs(stat.p95Ms)}
              delta={stat.p95PctChange}
              worseWhenUp
            />
            {stat.p99Ms != null && (
              <Metric
                label="p99"
                value={formatMs(stat.p99Ms)}
                delta={stat.p99PctChange}
                worseWhenUp
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <Metric
              label="Spans"
              value={compactNumber(stat.count)}
              delta={stat.countPctChange}
            />
            <Metric
              label="Error rate"
              value={`${errorRate.toFixed(1)}%`}
              delta={stat.errorRatePctChange}
              worseWhenUp
            />
          </div>

          {hasDelta && (
            <div className="text-[10px] text-muted-foreground">
              Δ {APM_STATS_WINDOW.comparisonLabel}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-t-(--gray-5) pt-2">
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              {file ? `${file}:${stat.line}` : `line ${stat.line}`}
            </span>
            {tracingUrl && (
              <button
                type="button"
                onClick={() => openExternalUrl(tracingUrl)}
                className="shrink-0 cursor-pointer whitespace-nowrap text-(--purple-11) text-xs hover:underline"
              >
                View in PostHog →
              </button>
            )}
          </div>
        </div>
      </Card>
    </div>,
    document.body,
  );
}

/**
 * Dependency-free export of an autoresearch run as a standalone HTML report
 * or a PNG image. The report is generated from run data (not screenshotted
 * from the live DOM), with all styles inline and no external resources, so
 * the HTML file opens anywhere and the PNG rasterization — SVG
 * `foreignObject` drawn onto a canvas — never taints the canvas.
 */
import type {
  AutoresearchIteration,
  AutoresearchRun,
  AutoresearchRunStatus,
} from "@posthog/core/autoresearch/schemas";
import {
  computeBest,
  isImprovement,
  summarizeRun,
} from "@posthog/core/autoresearch/stats";
import { withMetricUnit } from "./metricFormat";

export const REPORT_WIDTH = 760;

const CHART_WIDTH = 696;
const CHART_HEIGHT = 220;
const CHART_PADDING = { top: 12, right: 16, bottom: 24, left: 52 };

// Fixed light-theme palette so the export looks the same regardless of the
// app theme and needs no external stylesheets.
const COLOR = {
  text: "#1c2024",
  muted: "#60646c",
  faint: "#8b8d98",
  border: "#e0e1e6",
  surface: "#f9f9fb",
  axis: "#d9d9e0",
  accent: "#3e63dd",
  best: "#8b8d98",
  target: "#30a46c",
  targetText: "#218358",
  good: "#218358",
  bad: "#ce2c31",
};

const STATUS_LABEL: Record<AutoresearchRunStatus, string> = {
  running: "Running",
  paused: "Paused",
  interrupted: "Interrupted",
  completed: "Completed",
  stopped: "Stopped",
  failed: "Failed",
};

const numberFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 4,
});
const wholeNumberFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});
const fractionalNumberFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});
const dateTimeFormat = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatAxisValue(value: number): string {
  return (
    Math.abs(value) >= 1000 ? wholeNumberFormat : fractionalNumberFormat
  ).format(value);
}

/** Same layout math as `MetricChart`, emitted as a standalone SVG string. */
function buildChartSvg(run: AutoresearchRun): string {
  const { iterations } = run;
  if (iterations.length === 0) return "";
  const unit = run.metricUnit;
  const targetValue = run.config.targetValue;

  const all = iterations.flatMap((iteration) => [
    iteration.value,
    iteration.bestValue,
  ]);
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

  const innerWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
  const innerHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
  const x = (index: number) =>
    CHART_PADDING.left +
    (iterations.length === 1
      ? innerWidth / 2
      : (index / (iterations.length - 1)) * innerWidth);
  const y = (value: number) =>
    CHART_PADDING.top + ((max - value) / (max - min)) * innerHeight;

  const valuePath = iterations
    .map((iteration, i) => `${x(i)},${y(iteration.value)}`)
    .join(" ");
  const bestPath = iterations
    .map((iteration, i) => `${x(i)},${y(iteration.bestValue)}`)
    .join(" ");

  const dots = iterations
    .map(
      (iteration, i) =>
        `<circle cx="${x(i)}" cy="${y(iteration.value)}" r="3" fill="${COLOR.accent}"/>`,
    )
    .join("");

  const target =
    targetValue === null
      ? ""
      : `<line x1="${CHART_PADDING.left}" y1="${y(targetValue)}" x2="${CHART_WIDTH - CHART_PADDING.right}" y2="${y(targetValue)}" stroke="${COLOR.target}" stroke-dasharray="2 4"/>` +
        `<text x="${CHART_WIDTH - CHART_PADDING.right}" y="${y(targetValue) - 4}" text-anchor="end" fill="${COLOR.targetText}" font-size="10">target ${escapeHtml(withMetricUnit(formatAxisValue(targetValue), unit))}</text>`;

  const lastIndex =
    iterations.length > 1
      ? `<text x="${x(iterations.length - 1)}" y="${CHART_HEIGHT - CHART_PADDING.bottom + 14}" text-anchor="middle" fill="${COLOR.faint}" font-size="10">${iterations[iterations.length - 1].index}</text>`
      : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" role="img">` +
    `<rect x="0.5" y="0.5" width="${CHART_WIDTH - 1}" height="${CHART_HEIGHT - 1}" rx="6" fill="${COLOR.surface}" stroke="${COLOR.border}"/>` +
    `<text x="${CHART_PADDING.left - 6}" y="${y(max) + 10}" text-anchor="end" fill="${COLOR.faint}" font-size="10">${escapeHtml(withMetricUnit(formatAxisValue(max), unit))}</text>` +
    `<text x="${CHART_PADDING.left - 6}" y="${y(min)}" text-anchor="end" fill="${COLOR.faint}" font-size="10">${escapeHtml(withMetricUnit(formatAxisValue(min), unit))}</text>` +
    `<line x1="${CHART_PADDING.left}" y1="${CHART_PADDING.top}" x2="${CHART_PADDING.left}" y2="${CHART_HEIGHT - CHART_PADDING.bottom}" stroke="${COLOR.axis}"/>` +
    `<line x1="${CHART_PADDING.left}" y1="${CHART_HEIGHT - CHART_PADDING.bottom}" x2="${CHART_WIDTH - CHART_PADDING.right}" y2="${CHART_HEIGHT - CHART_PADDING.bottom}" stroke="${COLOR.axis}"/>` +
    target +
    `<polyline points="${bestPath}" fill="none" stroke="${COLOR.best}" stroke-width="1.5" stroke-dasharray="4 4"/>` +
    `<polyline points="${valuePath}" fill="none" stroke="${COLOR.accent}" stroke-width="2"/>` +
    dots +
    `<text x="${x(0)}" y="${CHART_HEIGHT - CHART_PADDING.bottom + 14}" text-anchor="middle" fill="${COLOR.faint}" font-size="10">1</text>` +
    lastIndex +
    "</svg>"
  );
}

function formatDelta(
  iteration: AutoresearchIteration,
  unit: string | null,
): string {
  if (iteration.delta === null) return "—";
  return withMetricUnit(
    `${iteration.delta > 0 ? "+" : ""}${numberFormat.format(iteration.delta)}`,
    unit,
  );
}

function deltaColor(delta: number | null, run: AutoresearchRun): string {
  if (delta === null || delta === 0) return COLOR.muted;
  return isImprovement(delta, 0, run.config.direction) ? COLOR.good : COLOR.bad;
}

function buildIterationsTable(run: AutoresearchRun): string {
  if (run.iterations.length === 0) {
    return `<p class="muted">No iterations recorded.</p>`;
  }
  const unit = run.metricUnit;
  const best = computeBest(run.iterations, run.config.direction);
  const rows = [...run.iterations]
    .reverse()
    .map((iteration) => {
      const bestTag =
        best?.index === iteration.index ? `<span class="tag">best</span>` : "";
      return (
        "<tr>" +
        `<td>${iteration.index}</td>` +
        `<td class="num">${escapeHtml(withMetricUnit(numberFormat.format(iteration.value), unit))}${bestTag}</td>` +
        `<td class="num" style="color:${deltaColor(iteration.delta, run)}">${escapeHtml(formatDelta(iteration, unit))}</td>` +
        `<td>${iteration.summary ? escapeHtml(iteration.summary) : "—"}</td>` +
        `<td class="muted">${escapeHtml(dateTimeFormat.format(iteration.at))}</td>` +
        "</tr>"
      );
    })
    .join("");
  return (
    "<table>" +
    "<thead><tr><th>#</th><th>Value</th><th>Δ</th><th>Change</th><th>Time</th></tr></thead>" +
    `<tbody>${rows}</tbody>` +
    "</table>"
  );
}

function statCard(label: string, value: string): string {
  return `<div class="stat"><div class="stat-label">${escapeHtml(label)}</div><div class="stat-value">${escapeHtml(value)}</div></div>`;
}

const REPORT_STYLES = `
.autoresearch-report { box-sizing: border-box; width: ${REPORT_WIDTH}px; padding: 32px; background: #ffffff; color: ${COLOR.text}; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 13px; line-height: 1.5; }
.autoresearch-report * { box-sizing: border-box; }
.autoresearch-report header { display: flex; align-items: center; gap: 8px; }
.autoresearch-report h1 { margin: 0; font-size: 18px; font-weight: 700; }
.autoresearch-report .badge { border-radius: 4px; padding: 1px 6px; font-size: 11px; background: ${COLOR.surface}; border: 1px solid ${COLOR.border}; color: ${COLOR.muted}; }
.autoresearch-report .meta { margin: 4px 0 16px; color: ${COLOR.muted}; font-size: 12px; }
.autoresearch-report .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; }
.autoresearch-report .stat { border: 1px solid ${COLOR.border}; background: ${COLOR.surface}; border-radius: 6px; padding: 8px 12px; }
.autoresearch-report .stat-label { color: ${COLOR.muted}; font-size: 11px; }
.autoresearch-report .stat-value { font-weight: 500; font-variant-numeric: tabular-nums; }
.autoresearch-report figure { margin: 0 0 16px; }
.autoresearch-report figcaption { margin-top: 4px; color: ${COLOR.faint}; font-size: 11px; }
.autoresearch-report table { width: 100%; border-collapse: collapse; font-size: 12px; }
.autoresearch-report th { text-align: left; font-weight: 600; padding: 6px 8px; border-bottom: 1px solid ${COLOR.border}; }
.autoresearch-report td { padding: 6px 8px; border-bottom: 1px solid ${COLOR.surface}; vertical-align: top; }
.autoresearch-report .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
.autoresearch-report .tag { margin-left: 6px; border-radius: 4px; padding: 0 4px; font-size: 10px; background: #fefbe9; border: 1px solid #f3d673; color: #ab6400; }
.autoresearch-report .muted { color: ${COLOR.muted}; }
.autoresearch-report .brief { margin-top: 16px; }
.autoresearch-report h2 { margin: 0 0 4px; font-size: 13px; font-weight: 600; }
.autoresearch-report .brief p { margin: 0; white-space: pre-wrap; color: ${COLOR.muted}; }
.autoresearch-report footer { margin-top: 24px; color: ${COLOR.faint}; font-size: 11px; }
`;

/** The report's inner markup: everything inside (and including) the root div. */
export function buildReportBody(
  run: AutoresearchRun,
  exportedAt: Date,
): string {
  const unit = run.metricUnit;
  const summary = summarizeRun(run);
  const title = run.metricName ?? "Autoresearch";

  const metaParts = [
    `Started ${dateTimeFormat.format(run.startedAt)}`,
    run.endedAt ? `Ended ${dateTimeFormat.format(run.endedAt)}` : null,
    `Exported ${dateTimeFormat.format(exportedAt)}`,
  ].filter((part): part is string => part !== null);

  const stats = [
    statCard(
      "Best",
      summary.best
        ? `${withMetricUnit(numberFormat.format(summary.best.value), unit)} (iter ${summary.best.index})`
        : "—",
    ),
    statCard(
      "Last",
      summary.last
        ? withMetricUnit(numberFormat.format(summary.last.value), unit)
        : "—",
    ),
    statCard(
      "Iterations",
      `${summary.iterationCount} / ${run.config.maxIterations}`,
    ),
    statCard(
      "Target",
      run.config.targetValue === null
        ? "—"
        : withMetricUnit(numberFormat.format(run.config.targetValue), unit),
    ),
  ].join("");

  const chart = buildChartSvg(run);
  const chartBlock = chart
    ? `<figure>${chart}<figcaption>solid: value per iteration · dashed: best so far</figcaption></figure>`
    : "";

  return (
    `<div class="autoresearch-report">` +
    `<header><h1>${escapeHtml(title)}</h1><span class="badge">${escapeHtml(run.config.direction)}</span><span class="badge">${escapeHtml(STATUS_LABEL[run.status])}</span></header>` +
    `<p class="meta">${escapeHtml(metaParts.join(" · "))}</p>` +
    `<div class="stats">${stats}</div>` +
    chartBlock +
    buildIterationsTable(run) +
    `<section class="brief"><h2>Brief</h2><p>${escapeHtml(run.config.instructions)}</p></section>` +
    `<footer>Autoresearch report · exported from PostHog Code</footer>` +
    "</div>"
  );
}

/** A complete, self-contained HTML document for the run. */
export function buildReportHtml(
  run: AutoresearchRun,
  exportedAt: Date,
): string {
  const title = run.metricName ?? "Autoresearch";
  return (
    "<!doctype html>" +
    `<html lang="en"><head><meta charset="utf-8"/>` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"/>` +
    `<title>${escapeHtml(title)} — autoresearch report</title>` +
    `<style>body { margin: 0; display: flex; justify-content: center; background: ${COLOR.surface}; }${REPORT_STYLES}</style>` +
    `</head><body>${buildReportBody(run, exportedAt)}</body></html>`
  );
}

export function reportFileName(
  run: AutoresearchRun,
  extension: string,
): string {
  const slug = (run.metricName ?? "report")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `autoresearch-${slug || "report"}.${extension}`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Deferred so the download grabs the blob before the URL dies.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("Failed to rasterize the report SVG"));
    image.src = url;
  });
}

/**
 * Render the report markup to a PNG: mount it offscreen to measure its
 * height, serialize it into an SVG `foreignObject`, and draw that onto a
 * canvas at 2x. Self-contained markup keeps the canvas untainted.
 */
async function renderReportPng(run: AutoresearchRun): Promise<Blob> {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-100000px";
  host.style.top = "0";
  host.style.width = `${REPORT_WIDTH}px`;
  // The extra wrapper is what gets serialized, so the host's offscreen
  // positioning never leaks into the image.
  host.innerHTML = `<div><style>${REPORT_STYLES}</style>${buildReportBody(run, new Date())}</div>`;
  document.body.appendChild(host);

  let width: number;
  let height: number;
  let serialized: string;
  try {
    width = REPORT_WIDTH;
    height = Math.ceil(host.getBoundingClientRect().height);
    const wrapper = host.firstElementChild;
    if (!wrapper) throw new Error("Report markup failed to parse");
    // XMLSerializer emits well-formed XHTML (with the xhtml namespace on the
    // root), which foreignObject requires.
    serialized = new XMLSerializer().serializeToString(wrapper);
  } finally {
    host.remove();
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject width="100%" height="100%">${serialized}</foreignObject>` +
    "</svg>";
  const url = URL.createObjectURL(
    new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
  );
  try {
    const image = await loadImage(url);
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context unavailable");
    context.scale(scale, scale);
    context.drawImage(image, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) throw new Error("PNG encoding failed");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function exportRunAsHtml(run: AutoresearchRun): void {
  const html = buildReportHtml(run, new Date());
  downloadBlob(
    new Blob([html], { type: "text/html;charset=utf-8" }),
    reportFileName(run, "html"),
  );
}

export async function exportRunAsPng(run: AutoresearchRun): Promise<void> {
  const blob = await renderReportPng(run);
  downloadBlob(blob, reportFileName(run, "png"));
}

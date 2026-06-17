import type { SignalReport } from "@posthog/shared/types";
import { isExcludedFromInbox, isPullRequestReport } from "./reportMembership";

/**
 * Inbox activity heatmap — a GitHub-contribution-style grid of daily Responder
 * output, used to show the value the inbox has produced over the last year.
 *
 * Everything here is pure: it counts `SignalReport`s (the inbox unit) by their
 * `created_at` day using the existing membership predicates. There is no
 * separate "pull request" entity — a PR in the inbox is a report carrying
 * `implementation_pr_url`, matched by `isPullRequestReport`. Nothing here reads
 * `status` as a completion/merge signal: `ready` only means the run finished,
 * not that a PR landed, so the metrics deliberately avoid that interpretation.
 */

export type InboxHeatmapMetric = "pull_requests" | "reports_created";

export interface InboxHeatmapMetricMeta {
  key: InboxHeatmapMetric;
  /** Short label for the metric toggle. */
  label: string;
  /** Tooltip noun, e.g. "1 pull request". */
  unitSingular: string;
  /** Tooltip noun, e.g. "3 pull requests". */
  unitPlural: string;
  /** One-line caption describing what is counted and the date basis. */
  description: string;
  /**
   * Membership test. A report is tallied on its `created_at` day when this
   * returns true. Built only from existing inbox membership helpers so the
   * heatmap stays aligned with the tab counts.
   */
  includes: (report: SignalReport) => boolean;
}

export const INBOX_HEATMAP_METRICS: Record<
  InboxHeatmapMetric,
  InboxHeatmapMetricMeta
> = {
  pull_requests: {
    key: "pull_requests",
    label: "Pull requests",
    unitSingular: "pull request",
    unitPlural: "pull requests",
    description:
      "Reports where the Responder opened a pull request, by the day the report was created.",
    includes: isPullRequestReport,
  },
  reports_created: {
    key: "reports_created",
    label: "Reports",
    unitSingular: "report",
    unitPlural: "reports",
    description: "Reports surfaced into the inbox, by the day they were created.",
    includes: (report) => !isExcludedFromInbox(report),
  },
};

/**
 * Default metric. Pull requests are the clearest signal of value created — each
 * one is a code change the Responder drafted — and `isPullRequestReport` is an
 * exact, existing membership rule, so the count is accurate.
 */
export const DEFAULT_INBOX_HEATMAP_METRIC: InboxHeatmapMetric = "pull_requests";

export type InboxHeatmapLevel = 0 | 1 | 2 | 3 | 4;

export interface InboxHeatmapDay {
  /** Local calendar day this cell represents (midnight, local time). */
  date: Date;
  /** Local `YYYY-MM-DD` key. */
  dayKey: string;
  /** Matching reports created on this day. */
  count: number;
  /** GitHub-style intensity bucket: 0 (none) … 4 (busiest). */
  level: InboxHeatmapLevel;
  /** True for grid cells in the future (the tail of the current week). */
  isFuture: boolean;
}

export interface InboxHeatmapWeek {
  /** Always 7 cells, Sunday → Saturday. */
  days: InboxHeatmapDay[];
}

export interface InboxHeatmap {
  metric: InboxHeatmapMetric;
  /** Week columns, oldest → newest. */
  weeks: InboxHeatmapWeek[];
  /** Total matching reports inside the rendered window. */
  totalCount: number;
  /** Days inside the window with at least one matching report. */
  activeDays: number;
  /** Busiest single day inside the window. */
  maxCount: number;
  /** First in-range (real) day rendered. */
  rangeStart: Date;
  /** Last in-range day rendered (the reference "today"). */
  rangeEnd: Date;
}

export interface ComputeInboxHeatmapOptions {
  reports: SignalReport[];
  metric: InboxHeatmapMetric;
  /** Reference "today"; the grid ends on the week containing this date. */
  now: Date;
  /** Number of week columns to render. Default 53 (~1 year, like GitHub). */
  weeks?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WEEKS = 53;

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Local `YYYY-MM-DD` key for a date. */
export function inboxHeatmapDayKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function parseCreatedDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : startOfLocalDay(parsed);
}

/** Quartile bucket of `count` relative to the window's busiest day. */
function levelForCount(count: number, maxCount: number): InboxHeatmapLevel {
  if (count <= 0 || maxCount <= 0) return 0;
  const bucket = Math.ceil((count / maxCount) * 4);
  return Math.min(4, Math.max(1, bucket)) as InboxHeatmapLevel;
}

export function computeInboxHeatmap({
  reports,
  metric,
  now,
  weeks = DEFAULT_WEEKS,
}: ComputeInboxHeatmapOptions): InboxHeatmap {
  const weeksCount = Math.max(1, Math.floor(weeks));
  const { includes } = INBOX_HEATMAP_METRICS[metric];

  // 1. Tally matching reports by their local created-at day.
  const countsByDay = new Map<string, number>();
  for (const report of reports) {
    if (!includes(report)) continue;
    const created = parseCreatedDay(report.created_at);
    if (!created) continue;
    const key = inboxHeatmapDayKey(created);
    countsByDay.set(key, (countsByDay.get(key) ?? 0) + 1);
  }

  // 2. Window: `weeksCount` Sunday-started columns ending on the week of `now`.
  const today = startOfLocalDay(now);
  const currentWeekSunday = addDays(today, -today.getDay());
  const firstSunday = addDays(currentWeekSunday, -(weeksCount - 1) * 7);
  const todayMs = today.getTime();

  // 3. First pass over in-range days to find the busiest one for leveling.
  let maxCount = 0;
  let totalCount = 0;
  let activeDays = 0;
  const lastInRangeMs = todayMs;
  for (let i = 0; i < weeksCount * 7; i++) {
    const date = addDays(firstSunday, i);
    if (date.getTime() > lastInRangeMs) continue; // future tail
    const count = countsByDay.get(inboxHeatmapDayKey(date)) ?? 0;
    if (count > 0) {
      activeDays += 1;
      totalCount += count;
      if (count > maxCount) maxCount = count;
    }
  }

  // 4. Build the grid.
  const heatmapWeeks: InboxHeatmapWeek[] = [];
  for (let w = 0; w < weeksCount; w++) {
    const days: InboxHeatmapDay[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(firstSunday, w * 7 + d);
      const isFuture = date.getTime() > todayMs;
      const dayKey = inboxHeatmapDayKey(date);
      const count = isFuture ? 0 : (countsByDay.get(dayKey) ?? 0);
      days.push({
        date,
        dayKey,
        count,
        level: isFuture ? 0 : levelForCount(count, maxCount),
        isFuture,
      });
    }
    heatmapWeeks.push({ days });
  }

  return {
    metric,
    weeks: heatmapWeeks,
    totalCount,
    activeDays,
    maxCount,
    rangeStart: firstSunday,
    rangeEnd: today,
  };
}

export interface InboxHeatmapMonthLabel {
  /** Index into `heatmap.weeks` where this month's first column sits. */
  weekIndex: number;
  /** Short month name, e.g. "Jun". */
  label: string;
}

/**
 * Month labels for the top axis: one per month boundary, placed on the first
 * week column whose Sunday falls in a new month. Mirrors GitHub's sparse axis.
 */
export function inboxHeatmapMonthLabels(
  heatmap: InboxHeatmap,
  locale?: string,
): InboxHeatmapMonthLabel[] {
  const labels: InboxHeatmapMonthLabel[] = [];
  let lastMonth = -1;
  heatmap.weeks.forEach((week, weekIndex) => {
    const firstDay = week.days[0]?.date;
    if (!firstDay) return;
    const month = firstDay.getMonth();
    if (month !== lastMonth) {
      lastMonth = month;
      labels.push({
        weekIndex,
        label: firstDay.toLocaleDateString(locale, { month: "short" }),
      });
    }
  });
  return labels;
}

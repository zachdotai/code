import type { SignalReport } from "@posthog/shared/types";
import { describe, expect, it } from "vitest";
import {
  computeInboxHeatmap,
  DEFAULT_INBOX_HEATMAP_METRIC,
  INBOX_HEATMAP_METRICS,
  inboxHeatmapDayKey,
  inboxHeatmapMonthLabels,
} from "./inboxHeatmap";

// Midday-UTC timestamps so the local calendar day is stable across the test
// runner's timezone (any offset from -12h..+14h stays on the same day).
function fakeReport(overrides: Partial<SignalReport> = {}): SignalReport {
  return {
    id: "r1",
    title: "Test report",
    summary: "Summary",
    status: "ready",
    total_weight: 1,
    signal_count: 1,
    created_at: "2026-06-05T12:00:00Z",
    updated_at: "2026-06-05T12:00:00Z",
    artefact_count: 0,
    priority: null,
    actionability: null,
    is_suggested_reviewer: false,
    source_products: [],
    implementation_pr_url: null,
    ...overrides,
  };
}

const NOW = new Date("2026-06-17T12:00:00Z");

function dayCount(
  heatmap: ReturnType<typeof computeInboxHeatmap>,
  dayKey: string,
): number {
  for (const week of heatmap.weeks) {
    for (const day of week.days) {
      if (day.dayKey === dayKey) return day.count;
    }
  }
  return -1; // day not present in the grid
}

describe("computeInboxHeatmap", () => {
  it("counts only pull-request reports for the pull_requests metric", () => {
    const reports = [
      fakeReport({ id: "pr1", implementation_pr_url: "https://gh/pr/1" }),
      fakeReport({ id: "pr2", implementation_pr_url: "https://gh/pr/2" }),
      fakeReport({ id: "noPr", implementation_pr_url: null }),
    ];

    const heatmap = computeInboxHeatmap({
      reports,
      metric: "pull_requests",
      now: NOW,
    });

    expect(heatmap.totalCount).toBe(2);
    expect(dayCount(heatmap, inboxHeatmapDayKey(new Date(2026, 5, 5)))).toBe(2);
  });

  it("excludes suppressed and deleted reports from both metrics", () => {
    const reports = [
      fakeReport({ id: "ok", implementation_pr_url: "https://gh/pr/1" }),
      fakeReport({
        id: "suppressed",
        status: "suppressed",
        implementation_pr_url: "https://gh/pr/2",
      }),
      fakeReport({ id: "deleted", status: "deleted" }),
    ];

    const pulls = computeInboxHeatmap({
      reports,
      metric: "pull_requests",
      now: NOW,
    });
    const created = computeInboxHeatmap({
      reports,
      metric: "reports_created",
      now: NOW,
    });

    expect(pulls.totalCount).toBe(1);
    // reports_created counts the one non-excluded report (the PR one); the
    // suppressed and deleted reports are out of the inbox entirely.
    expect(created.totalCount).toBe(1);
  });

  it("does not treat status:ready as a merge/landed signal — a ready report with no PR is not counted by pull_requests", () => {
    const reports = [
      fakeReport({ status: "ready", implementation_pr_url: null }),
    ];

    const pulls = computeInboxHeatmap({
      reports,
      metric: "pull_requests",
      now: NOW,
    });

    expect(pulls.totalCount).toBe(0);
  });

  it("buckets reports by created_at day, not updated_at", () => {
    const reports = [
      fakeReport({
        id: "pr",
        implementation_pr_url: "https://gh/pr/1",
        created_at: "2026-06-10T12:00:00Z",
        updated_at: "2026-06-16T12:00:00Z",
      }),
    ];

    const heatmap = computeInboxHeatmap({
      reports,
      metric: "pull_requests",
      now: NOW,
    });

    expect(dayCount(heatmap, inboxHeatmapDayKey(new Date(2026, 5, 10)))).toBe(
      1,
    );
    expect(dayCount(heatmap, inboxHeatmapDayKey(new Date(2026, 5, 16)))).toBe(
      0,
    );
  });

  it("renders a Sunday-aligned grid of the requested number of weeks", () => {
    const heatmap = computeInboxHeatmap({
      reports: [],
      metric: "pull_requests",
      now: NOW,
      weeks: 53,
    });

    expect(heatmap.weeks).toHaveLength(53);
    for (const week of heatmap.weeks) {
      expect(week.days).toHaveLength(7);
      expect(week.days[0]?.date.getDay()).toBe(0); // Sunday
    }
    // Last column contains today.
    const lastWeek = heatmap.weeks[heatmap.weeks.length - 1];
    const todayKey = inboxHeatmapDayKey(new Date(2026, 5, 17));
    expect(lastWeek?.days.some((d) => d.dayKey === todayKey)).toBe(true);
  });

  it("marks days after today as future and never counts them", () => {
    // 2026-06-17 is a Wednesday, so Thu–Sat of the last column are in the future.
    const heatmap = computeInboxHeatmap({
      reports: [],
      metric: "pull_requests",
      now: NOW,
    });
    const lastWeek = heatmap.weeks[heatmap.weeks.length - 1];
    const futureDays = lastWeek?.days.filter((d) => d.isFuture) ?? [];
    expect(futureDays).toHaveLength(3);
    for (const day of futureDays) {
      expect(day.count).toBe(0);
      expect(day.level).toBe(0);
    }
  });

  it("drops reports created before the rendered window", () => {
    const reports = [
      fakeReport({
        id: "ancient",
        implementation_pr_url: "https://gh/pr/1",
        created_at: "2024-01-01T12:00:00Z",
      }),
    ];

    const heatmap = computeInboxHeatmap({
      reports,
      metric: "pull_requests",
      now: NOW,
      weeks: 53,
    });

    expect(heatmap.totalCount).toBe(0);
  });

  it("assigns the busiest day level 4 and lighter days lower levels", () => {
    const reports = [
      // 3 PRs on Jun 10 (busiest), 1 PR on Jun 5.
      ...Array.from({ length: 3 }, (_, i) =>
        fakeReport({
          id: `busy${i}`,
          implementation_pr_url: `https://gh/pr/busy${i}`,
          created_at: "2026-06-10T12:00:00Z",
        }),
      ),
      fakeReport({
        id: "light",
        implementation_pr_url: "https://gh/pr/light",
        created_at: "2026-06-05T12:00:00Z",
      }),
    ];

    const heatmap = computeInboxHeatmap({
      reports,
      metric: "pull_requests",
      now: NOW,
    });

    expect(heatmap.maxCount).toBe(3);
    expect(heatmap.activeDays).toBe(2);
    expect(heatmap.totalCount).toBe(4);

    const findLevel = (date: Date) => {
      const key = inboxHeatmapDayKey(date);
      for (const week of heatmap.weeks) {
        for (const day of week.days) if (day.dayKey === key) return day.level;
      }
      return -1;
    };
    expect(findLevel(new Date(2026, 5, 10))).toBe(4);
    expect(findLevel(new Date(2026, 5, 5))).toBe(2); // ceil(1/3 * 4) = 2
  });

  it("reports zero activity cleanly for an empty inbox", () => {
    const heatmap = computeInboxHeatmap({
      reports: [],
      metric: DEFAULT_INBOX_HEATMAP_METRIC,
      now: NOW,
    });
    expect(heatmap.totalCount).toBe(0);
    expect(heatmap.activeDays).toBe(0);
    expect(heatmap.maxCount).toBe(0);
    for (const week of heatmap.weeks) {
      for (const day of week.days) expect(day.level).toBe(0);
    }
  });
});

describe("INBOX_HEATMAP_METRICS", () => {
  it("defaults to pull requests", () => {
    expect(DEFAULT_INBOX_HEATMAP_METRIC).toBe("pull_requests");
  });

  it("each metric's includes predicate is exposed", () => {
    expect(
      INBOX_HEATMAP_METRICS.pull_requests.includes(
        fakeReport({ implementation_pr_url: "https://gh/pr/1" }),
      ),
    ).toBe(true);
    expect(
      INBOX_HEATMAP_METRICS.reports_created.includes(
        fakeReport({ status: "suppressed" }),
      ),
    ).toBe(false);
  });
});

describe("inboxHeatmapMonthLabels", () => {
  it("emits one label per month boundary in column order", () => {
    const heatmap = computeInboxHeatmap({
      reports: [],
      metric: "pull_requests",
      now: NOW,
      weeks: 53,
    });
    const labels = inboxHeatmapMonthLabels(heatmap, "en-US");

    expect(labels.length).toBeGreaterThan(0);
    // Week indices strictly increasing.
    for (let i = 1; i < labels.length; i++) {
      expect(labels[i]?.weekIndex).toBeGreaterThan(labels[i - 1]?.weekIndex);
    }
    // The final label should be the current month (June).
    expect(labels[labels.length - 1]?.label).toBe("Jun");
  });
});

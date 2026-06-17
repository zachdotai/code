import {
  computeInboxHeatmap,
  DEFAULT_INBOX_HEATMAP_METRIC,
  INBOX_HEATMAP_METRICS,
  type InboxHeatmapDay,
  type InboxHeatmapLevel,
  type InboxHeatmapMetric,
  inboxHeatmapMonthLabels,
} from "@posthog/core/inbox/inboxHeatmap";
import { cn, Skeleton } from "@posthog/quill";
import { useInboxAllReports } from "@posthog/ui/features/inbox/hooks/useInboxAllReports";
import { Flex, SegmentedControl, Text } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";

// The list is an infinite query that loads a page at a time. Pull a bounded
// number of pages so the year-long grid is populated without unbounded fetching
// on huge inboxes; older reports beyond this cap simply fall off the left edge.
const MAX_HEATMAP_PAGES = 10;

const LEVEL_CLASS: Record<InboxHeatmapLevel, string> = {
  0: "bg-(--gray-4)",
  1: "bg-(--accent-5)",
  2: "bg-(--accent-7)",
  3: "bg-(--accent-9)",
  4: "bg-(--accent-11)",
};

const WEEKDAY_ROWS = [
  { key: "sun", label: "" },
  { key: "mon", label: "Mon" },
  { key: "tue", label: "" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "" },
];

/**
 * GitHub-contribution-style heatmap of Responder output on the Inbox surface.
 * Each square is one day; intensity is the number of matching `SignalReport`s
 * created that day. The default metric (pull requests) shows the code changes
 * the Responder has shipped over the last year — a compact picture of the value
 * the inbox has produced. Metric membership reuses the inbox helpers, and no
 * metric treats `status: "ready"` as a merge/landed signal.
 */
export function InboxActivityHeatmap() {
  const [metric, setMetric] = useState<InboxHeatmapMetric>(
    DEFAULT_INBOX_HEATMAP_METRIC,
  );
  // Stamp "today" once per mount so the grid window is stable across renders.
  const [now] = useState(() => new Date());

  // Project-wide, unfiltered: the heatmap reflects all Responder activity, not
  // the active scope/search. Same query key as the Runs tab, so React Query
  // dedupes the fetch.
  const {
    allReports,
    isLoading,
    data,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useInboxAllReports({ ignoreScope: true, ignoreFilters: true });

  const pagesLoaded = data?.pages.length ?? 0;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && pagesLoaded < MAX_HEATMAP_PAGES) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, pagesLoaded, fetchNextPage]);

  const heatmap = useMemo(
    () => computeInboxHeatmap({ reports: allReports, metric, now }),
    [allReports, metric, now],
  );
  const monthLabels = useMemo(
    () => inboxHeatmapMonthLabels(heatmap),
    [heatmap],
  );
  const monthByWeek = useMemo(() => {
    const map = new Map<number, string>();
    for (const { weekIndex, label } of monthLabels) map.set(weekIndex, label);
    return map;
  }, [monthLabels]);

  const meta = INBOX_HEATMAP_METRICS[metric];
  const summary = `${heatmap.totalCount.toLocaleString()} ${
    heatmap.totalCount === 1 ? meta.unitSingular : meta.unitPlural
  } in the last year`;

  if (isLoading && allReports.length === 0) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 pt-4">
        <Skeleton className="h-[150px] w-full rounded-(--radius-3)" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 pt-4">
      <div className="rounded-(--radius-3) border border-(--gray-6) border-dashed bg-(--color-panel-solid) px-4 py-3.5">
        <Flex align="center" justify="between" gap="3" className="mb-3 min-w-0">
          <Flex direction="column" className="min-w-0">
            <Text className="font-medium text-[13px] text-gray-12">
              Activity
            </Text>
            <Text className="truncate text-[12px] text-gray-10 tabular-nums">
              {summary}
            </Text>
          </Flex>
          <SegmentedControl.Root
            value={metric}
            size="1"
            onValueChange={(value) => setMetric(value as InboxHeatmapMetric)}
            aria-label="Heatmap metric"
          >
            <SegmentedControl.Item value="pull_requests">
              {INBOX_HEATMAP_METRICS.pull_requests.label}
            </SegmentedControl.Item>
            <SegmentedControl.Item value="reports_created">
              {INBOX_HEATMAP_METRICS.reports_created.label}
            </SegmentedControl.Item>
          </SegmentedControl.Root>
        </Flex>

        <div className="overflow-x-auto pb-1">
          <div className="flex w-fit flex-col gap-1">
            {/* Month axis, aligned to the week columns below. */}
            <div className="flex gap-[3px] pl-[26px]">
              {heatmap.weeks.map((week, weekIndex) => (
                <div
                  key={`m-${week.days[0]?.dayKey ?? weekIndex}`}
                  className="relative h-3 w-2.5 shrink-0"
                >
                  {monthByWeek.has(weekIndex) && (
                    <span className="absolute top-0 left-0 whitespace-nowrap text-[10px] text-gray-10 leading-none">
                      {monthByWeek.get(weekIndex)}
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div className="flex gap-[3px]">
              {/* Weekday axis. */}
              <div className="mr-1 flex w-[22px] shrink-0 flex-col gap-[3px]">
                {WEEKDAY_ROWS.map((row) => (
                  <div
                    key={row.key}
                    className="flex h-2.5 items-center justify-end text-[9px] text-gray-10 leading-none"
                  >
                    {row.label}
                  </div>
                ))}
              </div>

              {heatmap.weeks.map((week, weekIndex) => (
                <div
                  key={`w-${week.days[0]?.dayKey ?? weekIndex}`}
                  className="flex shrink-0 flex-col gap-[3px]"
                >
                  {week.days.map((day) => (
                    <HeatmapCell key={day.dayKey} day={day} meta={meta} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        <Flex align="center" justify="between" gap="3" className="mt-3 min-w-0">
          <Text className="min-w-0 truncate text-[11px] text-gray-9">
            {meta.description}
          </Text>
          <Flex align="center" gap="1" className="shrink-0">
            <Text className="mr-0.5 text-[11px] text-gray-9">Less</Text>
            {([0, 1, 2, 3, 4] as InboxHeatmapLevel[]).map((level) => (
              <div
                key={level}
                className={cn("h-2.5 w-2.5 rounded-[2px]", LEVEL_CLASS[level])}
              />
            ))}
            <Text className="ml-0.5 text-[11px] text-gray-9">More</Text>
          </Flex>
        </Flex>
      </div>
    </div>
  );
}

function HeatmapCell({
  day,
  meta,
}: {
  day: InboxHeatmapDay;
  meta: (typeof INBOX_HEATMAP_METRICS)[InboxHeatmapMetric];
}) {
  if (day.isFuture) {
    return <div className="h-2.5 w-2.5 rounded-[2px] bg-transparent" />;
  }
  const dateLabel = day.date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const unit = day.count === 1 ? meta.unitSingular : meta.unitPlural;
  return (
    <div
      className={cn(
        "h-2.5 w-2.5 rounded-[2px] ring-(--gray-a3) ring-1 ring-inset",
        LEVEL_CLASS[day.level],
      )}
      title={`${day.count} ${unit} · ${dateLabel}`}
    />
  );
}

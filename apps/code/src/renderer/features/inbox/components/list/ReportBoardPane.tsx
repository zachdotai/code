import { ReportCardContent } from "@features/inbox/components/utils/ReportCardContent";
import {
  inboxStatusAccentCss,
  inboxStatusLabel,
} from "@features/inbox/utils/inboxSort";
import {
  ArrowsClockwiseIcon,
  CircleNotchIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { Box, Button, Checkbox, Flex, Text } from "@radix-ui/themes";
import type { SignalReport, SignalReportStatus } from "@shared/types";
import { motion } from "framer-motion";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef } from "react";

// Lanes shown on the board, in display order. Hidden statuses (`suppressed`,
// `deleted`) never appear here — they're already excluded from the inbox feed.
const BOARD_LANE_STATUSES: SignalReportStatus[] = [
  "ready",
  "pending_input",
  "in_progress",
  "candidate",
  "potential",
  "failed",
];

function groupReportsByStatus(
  reports: SignalReport[],
): Map<SignalReportStatus, SignalReport[]> {
  const grouped = new Map<SignalReportStatus, SignalReport[]>(
    BOARD_LANE_STATUSES.map((status) => [status, []]),
  );
  for (const report of reports) {
    const bucket = grouped.get(report.status);
    if (bucket) {
      bucket.push(report);
    }
  }
  return grouped;
}

// ── LoadMoreTrigger ─────────────────────────────────────────────────────────
// Sits at the bottom of the longest lane so the board keeps loading as the
// user scrolls.

function LoadMoreTrigger({
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !hasNextPage) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (!hasNextPage && !isFetchingNextPage) return null;

  return (
    <Flex ref={ref} align="center" justify="center" py="3">
      {isFetchingNextPage ? (
        <Text color="gray" className="text-[11px]">
          Loading more...
        </Text>
      ) : null}
    </Flex>
  );
}

// ── BoardCard ───────────────────────────────────────────────────────────────

interface BoardCardProps {
  report: SignalReport;
  index: number;
  isSelected: boolean;
  showCheckbox: boolean;
  onClick: (event: { metaKey: boolean; shiftKey: boolean }) => void;
  onToggleChecked: () => void;
}

function BoardCard({
  report,
  index,
  isSelected,
  showCheckbox,
  onClick,
  onToggleChecked,
}: BoardCardProps) {
  const isInteractiveTarget = (target: EventTarget | null): boolean => {
    return (
      target instanceof HTMLElement &&
      !!target.closest("a, button, input, select, textarea, [role='checkbox']")
    );
  };

  const handleActivate = (e: MouseEvent | KeyboardEvent): void => {
    if (isInteractiveTarget(e.target)) {
      return;
    }
    onClick({ metaKey: e.metaKey, shiftKey: e.shiftKey });
  };

  const selectedBgClass = isSelected ? "bg-gray-3" : "bg-(--color-panel-solid)";

  return (
    <motion.div
      role="button"
      tabIndex={-1}
      data-report-id={report.id}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.2,
        delay: Math.min(index * 0.02, 0.25),
        ease: [0.22, 1, 0.36, 1],
      }}
      onMouseDown={(e) => {
        e.preventDefault();
      }}
      onClick={handleActivate}
      onKeyDown={(e: KeyboardEvent) => {
        if (isInteractiveTarget(e.target)) {
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          handleActivate(e);
        }
      }}
      className={[
        "relative isolate w-full cursor-pointer overflow-hidden rounded-(--radius-2) border border-(--gray-5) p-2 text-left transition-colors",
        "before:pointer-events-none before:absolute before:inset-0 before:z-1 before:bg-gray-12 before:opacity-0 hover:before:opacity-[0.05]",
        selectedBgClass,
      ].join(" ")}
    >
      <Flex align="start" gap="2" className="relative z-2">
        {showCheckbox ? (
          <Flex
            align="center"
            justify="center"
            className="w-[16px] min-w-[16px] shrink-0 pt-0.5"
          >
            <Checkbox
              size="1"
              checked={isSelected}
              tabIndex={-1}
              onMouseDown={(e) => {
                e.preventDefault();
              }}
              onClick={(e) => {
                e.stopPropagation();
              }}
              onCheckedChange={() => onToggleChecked()}
              aria-label={
                isSelected
                  ? "Unselect report from bulk actions"
                  : "Select report for bulk actions"
              }
            />
          </Flex>
        ) : null}
        <div className="min-w-0 flex-1">
          <ReportCardContent report={report} compact />
        </div>
      </Flex>
    </motion.div>
  );
}

// ── BoardLane ───────────────────────────────────────────────────────────────

interface BoardLaneProps {
  status: SignalReportStatus;
  reports: SignalReport[];
  startIndex: number;
  selectedIdSet: Set<string>;
  showCheckboxes: boolean;
  onReportClick: (
    id: string,
    event: { metaKey: boolean; shiftKey: boolean },
  ) => void;
  onToggleReportSelection: (id: string) => void;
  footer?: ReactNode;
}

function BoardLane({
  status,
  reports,
  startIndex,
  selectedIdSet,
  showCheckboxes,
  onReportClick,
  onToggleReportSelection,
  footer,
}: BoardLaneProps) {
  const accent = inboxStatusAccentCss(status);
  const label = inboxStatusLabel(status);

  return (
    <Flex
      direction="column"
      className="w-[280px] min-w-[280px] shrink-0 border-r border-r-(--gray-5)"
    >
      <Flex
        align="center"
        gap="2"
        className="border-b border-b-(--gray-5) px-3 py-2"
      >
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: accent }}
        />
        <Text className="font-medium text-[12px] text-gray-12">{label}</Text>
        <Text color="gray" className="text-[11px]">
          {reports.length}
        </Text>
      </Flex>
      <Flex direction="column" gap="2" className="p-2">
        {reports.length === 0 ? (
          <Box className="rounded-(--radius-2) border border-(--gray-4) border-dashed py-4 text-center">
            <Text color="gray" className="text-[11px]">
              No reports
            </Text>
          </Box>
        ) : (
          reports.map((report, idx) => (
            <BoardCard
              key={report.id}
              report={report}
              index={startIndex + idx}
              isSelected={selectedIdSet.has(report.id)}
              showCheckbox={showCheckboxes}
              onClick={(e) => onReportClick(report.id, e)}
              onToggleChecked={() => onToggleReportSelection(report.id)}
            />
          ))
        )}
        {footer}
      </Flex>
    </Flex>
  );
}

// ── ReportBoardPane ─────────────────────────────────────────────────────────

interface ReportBoardPaneProps {
  reports: SignalReport[];
  allReports: SignalReport[];
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  hasSignalSources: boolean;
  searchQuery: string;
  hasActiveFilters: boolean;
  selectedReportIds: string[];
  onReportClick: (
    id: string,
    event: { metaKey: boolean; shiftKey: boolean },
  ) => void;
  onToggleReportSelection: (id: string) => void;
}

export function ReportBoardPane({
  reports,
  allReports,
  isLoading,
  isFetching,
  error,
  refetch,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  hasSignalSources,
  searchQuery,
  hasActiveFilters,
  selectedReportIds = [],
  onReportClick,
  onToggleReportSelection,
}: ReportBoardPaneProps) {
  const grouped = useMemo(() => groupReportsByStatus(reports), [reports]);

  // ── Loading skeleton ────────────────────────────────────────────────────
  if (isLoading && allReports.length === 0 && hasSignalSources) {
    return (
      <Flex>
        {BOARD_LANE_STATUSES.map((status) => (
          <Flex
            key={status}
            direction="column"
            className="w-[280px] min-w-[280px] shrink-0 border-r border-r-(--gray-5)"
          >
            <Box className="border-b border-b-(--gray-5) px-3 py-2">
              <Box className="h-[12px] w-[60%] animate-pulse rounded bg-gray-4" />
            </Box>
            <Flex direction="column" gap="2" className="p-2">
              {Array.from({ length: 3 }).map((_, idx) => (
                <Box
                  // biome-ignore lint/suspicious/noArrayIndexKey: static loading placeholders
                  key={idx}
                  className="h-[58px] animate-pulse rounded-(--radius-2) bg-gray-3"
                />
              ))}
            </Flex>
          </Flex>
        ))}
      </Flex>
    );
  }

  // ── Error state ─────────────────────────────────────────────────────────
  if (error) {
    return (
      <Flex align="center" justify="center" py="8" px="4">
        <Flex direction="column" align="center" gap="3" className="text-center">
          <WarningIcon size={20} className="text-amber-10" weight="bold" />
          <Text color="gray" className="text-[12px]">
            Could not load signals
          </Text>
          <Button
            size="1"
            variant="soft"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            {isFetching ? (
              <CircleNotchIcon size={12} className="animate-spin" />
            ) : (
              <ArrowsClockwiseIcon size={12} />
            )}
            Retry
          </Button>
        </Flex>
      </Flex>
    );
  }

  // ── No search results ───────────────────────────────────────────────────
  if (reports.length === 0 && searchQuery.trim()) {
    return (
      <Flex direction="column" align="center" justify="center" gap="2" py="6">
        <Text color="gray" className="text-[12px]">
          No matching reports
        </Text>
      </Flex>
    );
  }

  // ── No filter results ───────────────────────────────────────────────────
  if (reports.length === 0 && hasActiveFilters) {
    return (
      <Flex direction="column" align="center" justify="center" gap="2" py="6">
        <Text color="gray" className="text-[12px]">
          No reports match current filters
        </Text>
      </Flex>
    );
  }

  const selectedIdSet = new Set(selectedReportIds);
  const showCheckboxes = selectedReportIds.length > 1;

  // Place the "load more" sentinel at the bottom of the lane that has the
  // most reports — that's the column the user is most likely scrolling.
  const longestLaneStatus = BOARD_LANE_STATUSES.reduce<SignalReportStatus>(
    (best, status) =>
      (grouped.get(status)?.length ?? 0) > (grouped.get(best)?.length ?? 0)
        ? status
        : best,
    BOARD_LANE_STATUSES[0],
  );

  let runningIndex = 0;

  return (
    <Box className="overflow-x-auto">
      <Flex className="min-w-fit">
        {BOARD_LANE_STATUSES.map((status) => {
          const laneReports = grouped.get(status) ?? [];
          const startIndex = runningIndex;
          runningIndex += laneReports.length;
          return (
            <BoardLane
              key={status}
              status={status}
              reports={laneReports}
              startIndex={startIndex}
              selectedIdSet={selectedIdSet}
              showCheckboxes={showCheckboxes}
              onReportClick={onReportClick}
              onToggleReportSelection={onToggleReportSelection}
              footer={
                status === longestLaneStatus ? (
                  <LoadMoreTrigger
                    hasNextPage={hasNextPage}
                    isFetchingNextPage={isFetchingNextPage}
                    fetchNextPage={fetchNextPage}
                  />
                ) : null
              }
            />
          );
        })}
      </Flex>
    </Box>
  );
}

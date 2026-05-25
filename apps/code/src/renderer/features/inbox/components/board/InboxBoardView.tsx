import { ReportCardContent } from "@features/inbox/components/utils/ReportCardContent";
import { SOURCE_PRODUCT_META } from "@features/inbox/components/utils/source-product-icons";
import { useInboxSignalsFilterStore } from "@features/inbox/stores/inboxSignalsFilterStore";
import {
  inboxStatusAccentCss,
  inboxStatusLabel,
} from "@features/inbox/utils/inboxSort";
import {
  ArrowsClockwiseIcon,
  CircleNotchIcon,
  FileTextIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { Box, Button, Flex, ScrollArea, Text, Tooltip } from "@radix-ui/themes";
import type { SignalReport, SignalReportStatus } from "@shared/types";
import { motion } from "framer-motion";
import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
} from "react";

const COLUMN_ORDER: SignalReportStatus[] = [
  "ready",
  "pending_input",
  "in_progress",
  "failed",
  "candidate",
  "potential",
];

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    !!target.closest("a, button, input, select, textarea, [role='checkbox']")
  );
}

function SourceProductIcon({ sourceProducts }: { sourceProducts?: string[] }) {
  const firstProduct = sourceProducts?.[0];
  const meta = firstProduct ? SOURCE_PRODUCT_META[firstProduct] : undefined;

  if (!meta) {
    return (
      <span className="text-gray-8">
        <FileTextIcon size={14} />
      </span>
    );
  }

  return (
    <Tooltip content={`Initiated by ${meta.label}`}>
      <span style={{ color: meta.color }}>
        <meta.Icon size={14} />
      </span>
    </Tooltip>
  );
}

interface InboxBoardCardProps {
  report: SignalReport;
  isSelected: boolean;
  index: number;
  onClick: (event: { metaKey: boolean; shiftKey: boolean }) => void;
}

function InboxBoardCard({
  report,
  isSelected,
  index,
  onClick,
}: InboxBoardCardProps) {
  const handleActivate = (e: MouseEvent | KeyboardEvent) => {
    if (isInteractiveTarget(e.target)) return;
    onClick({ metaKey: e.metaKey, shiftKey: e.shiftKey });
  };

  return (
    <motion.div
      role="button"
      tabIndex={-1}
      data-report-id={report.id}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.18,
        delay: Math.min(index * 0.02, 0.2),
        ease: [0.22, 1, 0.36, 1],
      }}
      onMouseDown={(e) => {
        e.preventDefault();
      }}
      onClick={handleActivate}
      onKeyDown={(e: KeyboardEvent) => {
        if (isInteractiveTarget(e.target)) return;
        if (e.key === "Enter") {
          e.preventDefault();
          handleActivate(e);
        }
      }}
      className={[
        "relative isolate cursor-pointer rounded-(--radius-2) border bg-(--color-panel-solid) p-2 text-left transition-colors",
        "before:pointer-events-none before:absolute before:inset-0 before:rounded-(--radius-2) before:bg-gray-12 before:opacity-0 hover:before:opacity-[0.05]",
        isSelected
          ? "border-(--accent-8) ring-(--accent-8) ring-1"
          : "border-(--gray-5)",
      ].join(" ")}
    >
      <Flex align="start" gap="2" className="relative z-2">
        <Flex
          align="center"
          justify="center"
          className="w-[16px] min-w-[16px] shrink-0 pt-0.5"
        >
          <SourceProductIcon sourceProducts={report.source_products} />
        </Flex>
        <div className="min-w-0 flex-1">
          <ReportCardContent report={report} compact />
        </div>
      </Flex>
    </motion.div>
  );
}

interface BoardLoadMoreTriggerProps {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}

function BoardLoadMoreTrigger({
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: BoardLoadMoreTriggerProps) {
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
        <Text color="gray" className="text-[12px]">
          Loading more...
        </Text>
      ) : null}
    </Flex>
  );
}

interface InboxBoardColumnProps {
  status: SignalReportStatus;
  reports: SignalReport[];
  selectedIdSet: Set<string>;
  onReportClick: (
    id: string,
    event: { metaKey: boolean; shiftKey: boolean },
  ) => void;
}

function InboxBoardColumn({
  status,
  reports,
  selectedIdSet,
  onReportClick,
}: InboxBoardColumnProps) {
  const accent = inboxStatusAccentCss(status);
  const label = inboxStatusLabel(status);

  return (
    <Flex
      direction="column"
      className="h-full w-[300px] shrink-0 rounded-(--radius-3) border border-(--gray-5) bg-(--gray-2)"
    >
      <Flex
        align="center"
        justify="between"
        gap="2"
        className="shrink-0 border-b border-b-(--gray-5) px-3 py-2"
      >
        <Flex align="center" gap="2" className="min-w-0">
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: accent }}
          />
          <Text className="truncate font-medium text-(--gray-12) text-[12px] uppercase tracking-wide">
            {label}
          </Text>
        </Flex>
        <Text color="gray" className="shrink-0 text-[12px] tabular-nums">
          {reports.length}
        </Text>
      </Flex>

      <ScrollArea type="auto" className="min-h-0 flex-1">
        <Flex direction="column" gap="2" className="p-2">
          {reports.length === 0 ? (
            <Flex
              align="center"
              justify="center"
              className="rounded-(--radius-2) border border-(--gray-5) border-dashed py-6"
            >
              <Text color="gray" className="text-[12px]">
                No items
              </Text>
            </Flex>
          ) : (
            reports.map((report, index) => (
              <InboxBoardCard
                key={report.id}
                report={report}
                index={index}
                isSelected={selectedIdSet.has(report.id)}
                onClick={(e) => onReportClick(report.id, e)}
              />
            ))
          )}
        </Flex>
      </ScrollArea>
    </Flex>
  );
}

interface InboxBoardViewProps {
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
}

export function InboxBoardView({
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
  selectedReportIds,
  onReportClick,
}: InboxBoardViewProps) {
  const statusFilter = useInboxSignalsFilterStore((s) => s.statusFilter);

  const visibleStatuses = useMemo(() => {
    const allowed = new Set(statusFilter);
    return COLUMN_ORDER.filter((status) => allowed.has(status));
  }, [statusFilter]);

  const reportsByStatus = useMemo(() => {
    const map = new Map<SignalReportStatus, SignalReport[]>();
    for (const status of visibleStatuses) {
      map.set(status, []);
    }
    for (const report of reports) {
      const bucket = map.get(report.status);
      if (bucket) {
        bucket.push(report);
      }
    }
    return map;
  }, [reports, visibleStatuses]);

  const selectedIdSet = useMemo(
    () => new Set(selectedReportIds),
    [selectedReportIds],
  );

  if (isLoading && allReports.length === 0 && hasSignalSources) {
    return (
      <Flex gap="3" className="h-full p-3">
        {visibleStatuses.map((status) => (
          <Box
            key={status}
            className="w-[300px] shrink-0 animate-pulse rounded-(--radius-3) bg-(--gray-3)"
          />
        ))}
      </Flex>
    );
  }

  if (error) {
    return (
      <Flex align="center" justify="center" className="h-full" px="4">
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

  if (reports.length === 0 && searchQuery.trim()) {
    return (
      <Flex align="center" justify="center" className="h-full">
        <Text color="gray" className="text-[12px]">
          No matching reports
        </Text>
      </Flex>
    );
  }

  if (reports.length === 0 && hasActiveFilters) {
    return (
      <Flex align="center" justify="center" className="h-full">
        <Text color="gray" className="text-[12px]">
          No reports match current filters
        </Text>
      </Flex>
    );
  }

  return (
    <Flex direction="column" className="h-full min-h-0">
      <ScrollArea
        type="auto"
        scrollbars="horizontal"
        className="min-h-0 flex-1"
      >
        <Flex gap="3" className="h-full p-3">
          {visibleStatuses.map((status) => (
            <InboxBoardColumn
              key={status}
              status={status}
              reports={reportsByStatus.get(status) ?? []}
              selectedIdSet={selectedIdSet}
              onReportClick={onReportClick}
            />
          ))}
        </Flex>
      </ScrollArea>
      <BoardLoadMoreTrigger
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={fetchNextPage}
      />
    </Flex>
  );
}

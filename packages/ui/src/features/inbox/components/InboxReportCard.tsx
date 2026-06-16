import {
  ArrowSquareOut,
  CaretDown,
  CaretUp,
  Tray,
} from "@phosphor-icons/react";
import { useInboxReportById } from "@posthog/ui/features/inbox/hooks/useInboxReports";
import { useInboxReportSelectionStore } from "@posthog/ui/features/inbox/stores/inboxReportSelectionStore";
import { useInboxSignalsFilterStore } from "@posthog/ui/features/inbox/stores/inboxSignalsFilterStore";
import { navigateToInbox } from "@posthog/ui/router/navigationBridge";
import { Box, Flex, Spinner, Text } from "@radix-ui/themes";
import { useCallback, useState } from "react";
import { SignalReportActionabilityBadge } from "./utils/SignalReportActionabilityBadge";
import { SignalReportPriorityBadge } from "./utils/SignalReportPriorityBadge";
import { SignalReportStatusBadge } from "./utils/SignalReportStatusBadge";
import { SignalReportSummaryMarkdown } from "./utils/SignalReportSummaryMarkdown";

interface InboxReportCardProps {
  reportId: string;
}

/**
 * Compact, expandable card for the inbox report a task is associated with.
 * Rendered under the initial prompt so the report can be read inline instead
 * of navigating away to the inbox view. Reads the report from the same query
 * cache the inbox uses (`useInboxReportById`), so it stays in sync and an
 * "Open in inbox" action can reuse the warmed cache for the detail pane.
 */
export function InboxReportCard({ reportId }: InboxReportCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { data: report, isLoading } = useInboxReportById(reportId, {
    staleTime: 60_000,
  });

  const setSelectedReportIds = useInboxReportSelectionStore(
    (s) => s.setSelectedReportIds,
  );
  const resetFilters = useInboxSignalsFilterStore((s) => s.resetFilters);

  const handleOpenInInbox = useCallback(() => {
    // Reset inbox-local filters first so the report isn't hidden by an active
    // filter, then navigate and select it (mirrors the deep-link open path).
    resetFilters();
    navigateToInbox();
    setSelectedReportIds([reportId]);
  }, [reportId, resetFilters, setSelectedReportIds]);

  if (isLoading && !report) {
    return (
      <Flex
        align="center"
        gap="2"
        className="mt-2 rounded-md border border-gray-5 bg-gray-1 px-2.5 py-2"
      >
        <Spinner size="1" />
        <Text color="gray" className="text-[12px]">
          Loading inbox report...
        </Text>
      </Flex>
    );
  }

  if (!report) return null;

  return (
    <Box className="mt-2 overflow-hidden rounded-md border border-gray-5 bg-gray-1">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-gray-2"
      >
        <Tray size={14} weight="duotone" className="shrink-0 text-gray-10" />
        <Text className="min-w-0 flex-1 truncate font-medium text-[13px]">
          {report.title ?? "Inbox report"}
        </Text>
        <Box className="shrink-0">
          <SignalReportStatusBadge status={report.status} />
        </Box>
        {expanded ? (
          <CaretUp size={12} className="shrink-0 text-gray-10" />
        ) : (
          <CaretDown size={12} className="shrink-0 text-gray-10" />
        )}
      </button>

      {expanded && (
        <Flex
          direction="column"
          gap="2"
          className="border-gray-5 border-t px-2.5 py-2"
        >
          <SignalReportSummaryMarkdown
            content={report.summary}
            fallback="No summary available."
            variant="detail"
          />

          {(report.priority || report.actionability) && (
            <Flex align="center" gap="1" wrap="wrap">
              <SignalReportPriorityBadge priority={report.priority} />
              <SignalReportActionabilityBadge
                actionability={report.actionability}
              />
            </Flex>
          )}

          <button
            type="button"
            onClick={handleOpenInInbox}
            className="inline-flex items-center gap-1 self-start text-[12px] text-accent-11 hover:text-accent-12"
          >
            <ArrowSquareOut size={12} />
            <span>Open in inbox</span>
          </button>
        </Flex>
      )}
    </Box>
  );
}

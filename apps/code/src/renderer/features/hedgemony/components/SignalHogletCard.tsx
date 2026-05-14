import { useSortable } from "@dnd-kit/react/sortable";
import { getAuthenticatedClient } from "@features/auth/hooks/authClient";
import { useInboxReports } from "@features/inbox/hooks/useInboxReports";
import type { Hoglet } from "@main/services/hedgemony/schemas";
import { ArrowSquareOut, GitPullRequest, X } from "@phosphor-icons/react";
import { Badge, Flex, IconButton, Text, Tooltip } from "@radix-ui/themes";
import { useTRPC } from "@renderer/trpc";
import { trpcClient } from "@renderer/trpc/client";
import type { Task } from "@shared/types";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import { useNavigationStore } from "@stores/navigationStore";
import { useQuery } from "@tanstack/react-query";
import { track } from "@utils/analytics";
import { logger } from "@utils/logger";
import { useState } from "react";
import { toast } from "sonner";
import { SIGNAL_QUERY_PARAMS } from "../hooks/useSignalIngestion";
import {
  SIGNAL_STAGING_BUCKET,
  selectTaskSummary,
  useHogletStore,
} from "../stores/hogletStore";
import {
  PR_BADGE_COLOR,
  PR_STATE_LABEL,
  STATUS_BADGE_COLOR,
  type TaskStatus,
} from "./hogletStatus";

const log = logger.scope("signal-hoglet-card");

interface SignalHogletCardProps {
  hoglet: Hoglet;
  index: number;
}

/**
 * Holding-panel card for a signal-backed hoglet sitting in the staging area.
 * Two affordances beyond the wild card:
 *   - "↗" link jumps to the Inbox view for the operator to read the report.
 *   - "✕" dismisses: soft-deletes the hoglet sidecar and suppresses the
 *     underlying Inbox report via the existing signals lifecycle (no
 *     parallel state machine).
 */
export function SignalHogletCard({ hoglet, index }: SignalHogletCardProps) {
  const trpc = useTRPC();
  const summary = useHogletStore(selectTaskSummary(hoglet.taskId));
  const navigateToInbox = useNavigationStore((s) => s.navigateToInbox);
  const navigateToTask = useNavigationStore((s) => s.navigateToTask);
  const [dismissing, setDismissing] = useState(false);

  // Pull the matching signal report from the TanStack cache populated by
  // useSignalIngestion's polling call. No extra fetch — the data is already
  // in memory by the time this card renders.
  const reportsCache = useInboxReports(SIGNAL_QUERY_PARAMS, {
    enabled: false,
  });
  const signalReport =
    hoglet.signalReportId !== null
      ? (reportsCache.data?.results.find(
          (r) => r.id === hoglet.signalReportId,
        ) ?? null)
      : null;

  const { ref, isDragging } = useSortable({
    id: hoglet.id,
    index,
    group: "signal-staging-hoglets",
    data: {
      type: "hoglet",
      hogletId: hoglet.id,
      sourceNestId: null,
      sourceBucket: "signal_staging" as const,
    },
    transition: { duration: 200, easing: "ease" },
  });

  const prStatusQuery = useQuery(
    trpc.workspace.getTaskPrStatus.queryOptions(
      { taskId: hoglet.taskId, cloudPrUrl: null },
      { staleTime: 30_000 },
    ),
  );

  const status: TaskStatus = (summary?.latest_run?.status ??
    "not_started") as TaskStatus;
  const title =
    signalReport?.title ?? summary?.title ?? hoglet.taskId.slice(0, 8);
  const summaryText = signalReport?.summary ?? null;
  const prState = prStatusQuery.data?.prState ?? null;

  const handleClick = async () => {
    try {
      const client = await getAuthenticatedClient();
      if (!client) return;
      const task = (await client.getTask(hoglet.taskId)) as Task;
      navigateToTask(task);
    } catch (error) {
      log.error("Failed to open task", { taskId: hoglet.taskId, error });
    }
  };

  const handleOpenInbox = (event: React.MouseEvent) => {
    event.stopPropagation();
    navigateToInbox();
  };

  const handleDismiss = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (dismissing || hoglet.signalReportId === null) return;
    setDismissing(true);

    // Optimistic remove so the card disappears immediately. The watch
    // subscription would also remove it, but the network round-trip is
    // long enough that the user notices the lag without this.
    const original = useHogletStore
      .getState()
      .byBucket[SIGNAL_STAGING_BUCKET]?.find((h) => h.id === hoglet.id);
    useHogletStore.getState().remove(SIGNAL_STAGING_BUCKET, hoglet.id);

    try {
      await trpcClient.hedgemony.hoglets.dismissSignal.mutate({
        hogletId: hoglet.id,
      });
      try {
        const client = await getAuthenticatedClient();
        if (client) {
          await client.updateSignalReportState(hoglet.signalReportId, {
            state: "suppressed",
          });
        }
      } catch (error) {
        // Soft-failure: the hedgemony hoglet is gone but the upstream
        // suppression call failed. The report will resurface on the next
        // poll tick and re-ingest — log so we can diagnose.
        log.warn("Hoglet dismissed but report suppression failed", {
          reportId: hoglet.signalReportId,
          error,
        });
      }
      track(ANALYTICS_EVENTS.HEDGEMONY_HOGLET_DISMISSED, { source: "signal" });
    } catch (error) {
      log.error("Failed to dismiss signal-backed hoglet", {
        hogletId: hoglet.id,
        error,
      });
      if (original) {
        useHogletStore.getState().upsert(SIGNAL_STAGING_BUCKET, original);
      }
      toast.error("Could not dismiss signal");
    } finally {
      setDismissing(false);
    }
  };

  return (
    <div
      className="flex w-full flex-col gap-2 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2) p-3 transition-colors hover:bg-(--gray-3)"
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      <button
        ref={ref}
        type="button"
        onClick={handleClick}
        className="flex w-full cursor-grab flex-col gap-1 border-0 bg-transparent p-0 text-left active:cursor-grabbing"
      >
        <Text
          size="2"
          weight="medium"
          className="line-clamp-2 text-(--gray-12)"
        >
          {title}
        </Text>
        {summaryText && (
          <Text size="1" className="line-clamp-2 text-(--gray-10)">
            {summaryText}
          </Text>
        )}
      </button>
      <Flex align="center" gap="2" wrap="wrap">
        <Badge size="1" color={status ? STATUS_BADGE_COLOR[status] : "gray"}>
          {status ?? "not_started"}
        </Badge>
        {prState && (
          <Badge size="1" color={PR_BADGE_COLOR[prState]}>
            <GitPullRequest size={10} weight="bold" />
            {PR_STATE_LABEL[prState]}
          </Badge>
        )}
        <span className="flex-1" />
        <Tooltip content="View in Inbox">
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            onClick={handleOpenInbox}
            aria-label="View in Inbox"
          >
            <ArrowSquareOut size={12} weight="bold" />
          </IconButton>
        </Tooltip>
        <Tooltip content="Dismiss (suppresses the Inbox report)">
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            onClick={handleDismiss}
            disabled={dismissing}
            aria-label="Dismiss"
          >
            <X size={12} weight="bold" />
          </IconButton>
        </Tooltip>
      </Flex>
    </div>
  );
}

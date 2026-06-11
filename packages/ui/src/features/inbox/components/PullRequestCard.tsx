import { extractRepoSelectionRepository } from "@posthog/core/inbox/artefacts";
import {
  deriveHeadline,
  displayConventionalCommitTitle,
  parseConventionalCommitTitle,
  parsePrUrl,
} from "@posthog/core/inbox/reportPresentation";
import type { SignalReport } from "@posthog/shared/types";
import { PrDiffStats } from "@posthog/ui/features/inbox/components/PrDiffStats";
import { PullRequestCardView } from "@posthog/ui/features/inbox/components/PullRequestCardView";
import { SuggestedReviewerAvatarStack } from "@posthog/ui/features/inbox/components/SuggestedReviewerAvatarStack";
import { ReportImplementationPrLink } from "@posthog/ui/features/inbox/components/utils/ReportImplementationPrLink";
import { useInboxReportDetailPrefetch } from "@posthog/ui/features/inbox/hooks/useInboxReportDetailPrefetch";
import { useInboxReportArtefacts } from "@posthog/ui/features/inbox/hooks/useInboxReports";
import { Flex } from "@radix-ui/themes";
import { Link, useNavigate } from "@tanstack/react-router";
import type { MouseEvent } from "react";

interface PullRequestCardProps {
  report: SignalReport;
  isSelected?: boolean;
  onRowClick?: (event: MouseEvent) => void;
  onDismiss: () => void;
  dismissDisabledReason?: string | null;
  isDismissPending?: boolean;
}

export function PullRequestCard({
  report,
  isSelected = false,
  onRowClick,
  onDismiss,
  dismissDisabledReason = null,
  isDismissPending = false,
}: PullRequestCardProps) {
  const detailRoute = {
    to: "/code/inbox/pulls/$reportId" as const,
    params: { reportId: report.id },
  };
  const { prefetch, pointerHandlers } = useInboxReportDetailPrefetch(
    report,
    detailRoute,
  );
  const navigate = useNavigate();
  const prRef = report.implementation_pr_url
    ? parsePrUrl(report.implementation_pr_url)
    : null;
  const { data: artefactsResp } = useInboxReportArtefacts(report.id, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const repoSlug =
    extractRepoSelectionRepository(artefactsResp?.results) ?? prRef?.repoSlug;

  const conventionalTitle = parseConventionalCommitTitle(report.title);
  const cardTitle = displayConventionalCommitTitle(
    report.title,
    "Untitled pull request",
  );

  return (
    <PullRequestCardView
      priority={report.priority}
      conventionalTitle={conventionalTitle}
      title={cardTitle}
      headline={deriveHeadline(report.summary)}
      repoSlug={repoSlug}
      sourceProducts={report.source_products}
      isSelected={isSelected}
      pointerHandlers={pointerHandlers}
      diffSlot={
        report.implementation_pr_url ? (
          <Flex direction="column" align="end" gap="1" className="shrink-0">
            <ReportImplementationPrLink
              prUrl={report.implementation_pr_url}
              size="sm"
            />
            <PrDiffStats
              prUrl={report.implementation_pr_url}
              hideWhileLoading
            />
          </Flex>
        ) : null
      }
      reviewersSlot={
        <SuggestedReviewerAvatarStack
          reportId={report.id}
          artefacts={artefactsResp ?? null}
        />
      }
      onReview={() => {
        prefetch();
        navigate(detailRoute);
      }}
      onDismiss={onDismiss}
      dismissDisabledReason={dismissDisabledReason}
      isDismissPending={isDismissPending}
      renderSummary={(summary, className) => (
        <Link
          {...detailRoute}
          preload="intent"
          onClick={(event) => {
            onRowClick?.(event);
            if (event.metaKey || event.ctrlKey || event.shiftKey) {
              event.preventDefault();
              return;
            }
            prefetch();
          }}
          className={className}
        >
          {summary}
        </Link>
      )}
    />
  );
}

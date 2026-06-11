import { ThumbsDownIcon } from "@phosphor-icons/react";
import { Button, cn } from "@posthog/quill";
import type { SignalReportPriority } from "@posthog/shared/types";
import { ConventionalCommitScopeTag } from "@posthog/ui/features/inbox/components/ConventionalCommitScopeTag";
import { InboxCardSourceMeta } from "@posthog/ui/features/inbox/components/InboxCardSourceMeta";
import { InboxCardTitle } from "@posthog/ui/features/inbox/components/InboxCardTitle";
import { PriorityMonogram } from "@posthog/ui/features/inbox/components/PriorityMonogram";
import { Button as UiButton } from "@posthog/ui/primitives/Button";
import { Flex, Text } from "@radix-ui/themes";
import type { MouseEvent, ReactNode } from "react";

/** Layout class for the clickable left region; shared so the real card's `<Link>` matches. */
export const PULL_REQUEST_CARD_ROW_CLASS =
  "flex min-w-0 flex-1 items-start gap-3 text-left text-inherit no-underline focus-visible:outline-none";

interface PullRequestCardViewProps {
  priority: SignalReportPriority | null | undefined;
  conventionalTitle: { type: string; scope: string | null } | null;
  title: string;
  headline?: string | null;
  repoSlug?: string | null;
  sourceProducts?: string[] | null;
  isSelected?: boolean;
  /** Diff adornment (`<PrDiffStats>` in the real card, a static `<PrDiffIndicator>` in previews). */
  diffSlot?: ReactNode;
  /** Suggested-reviewer avatars; omitted in previews. */
  reviewersSlot?: ReactNode;
  reviewLabel?: string;
  onReview?: (event: MouseEvent) => void;
  /** Omit to hide the dismiss affordance entirely (e.g. previews). */
  onDismiss?: () => void;
  dismissDisabledReason?: string | null;
  isDismissPending?: boolean;
  pointerHandlers?: { onPointerDown?: () => void };
  /**
   * Wraps the summary region. The real card passes a TanStack `<Link>` so the row
   * navigates and preloads; previews leave it undefined to render a static `<div>`.
   */
  renderSummary?: (summary: ReactNode, className: string) => ReactNode;
}

/**
 * Pure, presentational pull-request card. Holds no router or query dependencies so it
 * can render identically in the live inbox list and in mocked onboarding previews.
 * `PullRequestCard` is the data-resolving wrapper around this view.
 */
export function PullRequestCardView({
  priority,
  conventionalTitle,
  title,
  headline = null,
  repoSlug = null,
  sourceProducts = null,
  isSelected = false,
  diffSlot,
  reviewersSlot,
  reviewLabel = "Review",
  onReview,
  onDismiss,
  dismissDisabledReason = null,
  isDismissPending = false,
  pointerHandlers,
  renderSummary,
}: PullRequestCardViewProps) {
  const summary = (
    <>
      <PriorityMonogram priority={priority} />
      <Flex direction="column" gap="1.5" className="min-w-0 flex-1">
        <Flex align="center" gap="1" wrap="wrap" className="min-w-0">
          {conventionalTitle && (
            <ConventionalCommitScopeTag
              type={conventionalTitle.type}
              scope={conventionalTitle.scope}
              compact
            />
          )}
          <InboxCardTitle>{title}</InboxCardTitle>
        </Flex>

        {headline ? (
          <Text className="wrap-break-word mt-0.5 line-clamp-2 text-[12.5px] text-gray-10 leading-snug">
            {headline}
          </Text>
        ) : null}

        <InboxCardSourceMeta
          repoSlug={repoSlug}
          sourceProducts={sourceProducts}
        />
      </Flex>
    </>
  );

  return (
    <div
      className={cn(
        "group flex w-full items-start gap-3 rounded-(--radius-2) border border-border bg-(--color-panel-solid) px-4 py-3.5 transition duration-150 hover:border-(--gray-6) hover:bg-(--gray-2) hover:shadow-sm",
        isSelected &&
          "border-(--accent-8) bg-(--accent-2) ring-(--accent-8) ring-2 ring-inset",
      )}
      {...pointerHandlers}
    >
      {renderSummary ? (
        renderSummary(summary, PULL_REQUEST_CARD_ROW_CLASS)
      ) : (
        <div className={PULL_REQUEST_CARD_ROW_CLASS}>{summary}</div>
      )}

      <Flex
        align="center"
        className="gap-3.5 self-stretch border-border border-l pl-3"
      >
        <Flex align="center" gap="2" className="shrink-0">
          {diffSlot}
          {reviewersSlot}
        </Flex>
        <Flex align="center" className="shrink-0 gap-2.5">
          {onDismiss && (
            <UiButton
              type="button"
              variant="soft"
              color="gray"
              size="1"
              aria-label="Archive this report"
              tooltipContent="Archive this report"
              disabled={dismissDisabledReason !== null || isDismissPending}
              disabledReason={dismissDisabledReason}
              loading={isDismissPending}
              onClick={(event) => {
                event.stopPropagation();
                onDismiss();
              }}
            >
              <ThumbsDownIcon size={14} />
            </UiButton>
          )}
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              onReview?.(event);
            }}
          >
            {reviewLabel}
          </Button>
        </Flex>
      </Flex>
    </div>
  );
}

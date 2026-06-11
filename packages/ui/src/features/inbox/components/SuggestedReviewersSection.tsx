import { CheckIcon, PlusIcon, User, XIcon } from "@phosphor-icons/react";
import type {
  AvailableSuggestedReviewer,
  SignalReport,
  SuggestedReviewer,
  SuggestedReviewersArtefact,
  SuggestedReviewerWriteEntry,
} from "@posthog/shared/types";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useCurrentUser } from "@posthog/ui/features/auth/useCurrentUser";
import { PeoplePickerList } from "@posthog/ui/features/inbox/components/PeoplePickerList";
import { RightColumnSection } from "@posthog/ui/features/inbox/components/RightColumnSection";
import { MeBadge } from "@posthog/ui/features/inbox/components/utils/MeBadge";
import { SuggestedReviewerAvatar } from "@posthog/ui/features/inbox/components/utils/SuggestedReviewerAvatar";
import {
  getSuggestedReviewerDisplayName,
  type SuggestedReviewerFilterOption,
} from "@posthog/ui/features/inbox/filterOptions";
import {
  useInboxReportArtefacts,
  useUpdateSuggestedReviewers,
} from "@posthog/ui/features/inbox/hooks/useInboxReports";
import { useReportActionTracker } from "@posthog/ui/features/inbox/hooks/useReportActionTracker";
import { useReviewerPickerOptions } from "@posthog/ui/features/inbox/hooks/useReviewerPickerOptions";
import { useDebounce } from "@posthog/ui/primitives/hooks/useDebounce";
import { Flex, Popover, Spinner, Text } from "@radix-ui/themes";
import { useMemo, useState } from "react";

function reviewerMatchesAvailable(
  reviewer: SuggestedReviewer,
  available: AvailableSuggestedReviewer,
): boolean {
  if (reviewer.user?.uuid && reviewer.user.uuid === available.uuid) {
    return true;
  }
  return (
    !!reviewer.github_login &&
    !!available.github_login &&
    reviewer.github_login.toLowerCase() === available.github_login.toLowerCase()
  );
}

function toWriteContent(
  reviewers: SuggestedReviewer[],
): SuggestedReviewerWriteEntry[] {
  return reviewers
    .map((reviewer): SuggestedReviewerWriteEntry | null => {
      if (reviewer.github_login) return { github_login: reviewer.github_login };
      if (reviewer.user?.uuid) return { user_uuid: reviewer.user.uuid };
      return null;
    })
    .filter((entry): entry is SuggestedReviewerWriteEntry => entry !== null);
}

interface SuggestedReviewersSectionProps {
  report: SignalReport;
}

export function SuggestedReviewersSection({
  report,
}: SuggestedReviewersSectionProps) {
  const { data: artefactsResp } = useInboxReportArtefacts(report.id);
  const artefact = artefactsResp?.results.find(
    (a): a is SuggestedReviewersArtefact => a.type === "suggested_reviewers",
  );
  if (!artefact) return null;
  return <SuggestedReviewersBody report={report} artefact={artefact} />;
}

function SuggestedReviewersBody({
  report,
  artefact,
}: {
  report: SignalReport;
  artefact: SuggestedReviewersArtefact;
}) {
  const client = useOptionalAuthenticatedClient();
  const fireAction = useReportActionTracker(report);
  const { data: currentUser } = useCurrentUser({ client, enabled: !!client });
  const meUuid = currentUser?.uuid;

  const [addOpen, setAddOpen] = useState(false);
  const [reviewerQuery, setReviewerQuery] = useState("");
  // Collapse the debounce window to 0 while the popover is closed so the next
  // open starts from a clean query instead of replaying the last keystroke.
  const debouncedQuery = useDebounce(reviewerQuery, addOpen ? 200 : 0);

  const { mutate: updateReviewers, isPending } = useUpdateSuggestedReviewers(
    report.id,
  );

  const reviewers = artefact.content;

  const displayReviewers = useMemo(() => {
    if (!meUuid) return reviewers;
    const meIndex = reviewers.findIndex((r) => r.user?.uuid === meUuid);
    if (meIndex <= 0) return reviewers;
    return [reviewers[meIndex], ...reviewers.filter((_, i) => i !== meIndex)];
  }, [reviewers, meUuid]);

  const { options: addableOptions, isFetching } = useReviewerPickerOptions({
    query: debouncedQuery,
    enabled: !!client && addOpen,
  });

  const removeReviewer = (target: SuggestedReviewer) => {
    const next = reviewers.filter((r) => r !== target);
    fireAction("remove_suggested_reviewer", {
      suggested_reviewer_login: target.github_login || undefined,
      suggested_reviewer_uuid: target.user?.uuid,
    });
    updateReviewers({
      artefactId: artefact.id,
      content: toWriteContent(next),
      optimisticReviewers: next,
    });
  };

  const toggleReviewer = (option: AvailableSuggestedReviewer) => {
    const existing = reviewers.find((r) => reviewerMatchesAvailable(r, option));
    if (existing) {
      removeReviewer(existing);
      return;
    }
    const optimisticEntry: SuggestedReviewer = {
      github_login: option.github_login,
      github_name: option.name || null,
      relevant_commits: [],
      user: {
        id: 0,
        uuid: option.uuid,
        email: option.email,
        first_name: option.name,
        last_name: "",
      },
    };
    const next = [...reviewers, optimisticEntry];
    fireAction("add_suggested_reviewer", {
      suggested_reviewer_login: option.github_login || undefined,
      suggested_reviewer_uuid: option.uuid,
    });
    updateReviewers({
      artefactId: artefact.id,
      content: [...toWriteContent(reviewers), { user_uuid: option.uuid }],
      optimisticReviewers: next,
    });
  };

  return (
    <RightColumnSection
      Icon={User}
      title="Reviewers"
      rightSlot={
        <Flex align="center" gap="2">
          {isPending && <Spinner size="1" />}
          <AddReviewerPopover
            open={addOpen}
            onOpenChange={(next) => {
              setAddOpen(next);
              if (!next) setReviewerQuery("");
            }}
            query={reviewerQuery}
            onQueryChange={setReviewerQuery}
            isFetching={isFetching}
            options={addableOptions}
            isPending={isPending}
            isAssigned={(option) =>
              reviewers.some((r) => reviewerMatchesAvailable(r, option))
            }
            onToggle={toggleReviewer}
          />
        </Flex>
      }
    >
      {displayReviewers.length === 0 ? (
        <Text className="text-[12px] text-gray-10">
          No reviewers assigned. Use "Add" to suggest one.
        </Text>
      ) : (
        <Flex direction="column" gap="0.5">
          {displayReviewers.map((reviewer) => (
            <ReviewerRow
              key={reviewer.user?.uuid ?? reviewer.github_login}
              reviewer={reviewer}
              isMe={!!meUuid && reviewer.user?.uuid === meUuid}
              isPending={isPending}
              onProfileClick={() =>
                fireAction("click_suggested_reviewer", {
                  suggested_reviewer_login: reviewer.github_login,
                })
              }
              onRemove={() => removeReviewer(reviewer)}
            />
          ))}
        </Flex>
      )}
    </RightColumnSection>
  );
}

function ReviewerRow({
  reviewer,
  isMe,
  isPending,
  onProfileClick,
  onRemove,
}: {
  reviewer: SuggestedReviewer;
  isMe: boolean;
  isPending: boolean;
  onProfileClick: () => void;
  onRemove: () => void;
}) {
  const profileHref = reviewer.github_login
    ? `https://github.com/${reviewer.github_login}`
    : null;
  const displayName =
    reviewer.github_name ?? reviewer.user?.first_name ?? reviewer.github_login;
  const reason = reviewer.relevant_commits[0]?.reason ?? null;
  const commit = reviewer.relevant_commits[0] ?? null;

  return (
    <Flex
      align="start"
      gap="2"
      className="group rounded-(--radius-1) px-1.5 py-1.5 transition-colors hover:bg-(--gray-2)"
    >
      {profileHref ? (
        <a
          href={profileHref}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open @${reviewer.github_login} on GitHub`}
          onClick={onProfileClick}
          className="mt-0.5 shrink-0"
        >
          <SuggestedReviewerAvatar
            githubLogin={reviewer.github_login}
            size="sm"
          />
        </a>
      ) : (
        <SuggestedReviewerAvatar
          githubLogin={reviewer.github_login}
          size="sm"
          className="mt-0.5 shrink-0"
        />
      )}
      <Flex direction="column" className="min-w-0 flex-1" gap="0.5">
        <Flex align="center" gap="2" wrap="wrap">
          {profileHref ? (
            <a
              href={profileHref}
              target="_blank"
              rel="noreferrer"
              onClick={onProfileClick}
              className="truncate font-medium text-[12px] text-gray-12 hover:underline"
            >
              {displayName}
            </a>
          ) : (
            <Text className="truncate font-medium text-[12px] text-gray-12">
              {displayName}
            </Text>
          )}
          {commit && (
            <a
              href={commit.url}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-(--gray-9) text-[11px] hover:text-gray-11"
            >
              {commit.sha.slice(0, 7)}
            </a>
          )}
          {isMe && <MeBadge />}
        </Flex>
        {reason && (
          <Text className="cursor-default select-none text-[11px] text-gray-10 leading-snug">
            {reason}
          </Text>
        )}
      </Flex>
      <button
        type="button"
        aria-label={`Remove ${reviewer.github_login || reviewer.user?.first_name || "reviewer"}`}
        disabled={isPending}
        onClick={onRemove}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-(--radius-1) text-(--gray-9) opacity-0 transition-opacity hover:bg-(--gray-3) hover:text-gray-12 focus-visible:opacity-100 disabled:opacity-60 group-hover:opacity-100"
      >
        <XIcon size={11} />
      </button>
    </Flex>
  );
}

function AddReviewerPopover({
  open,
  onOpenChange,
  query,
  onQueryChange,
  isFetching,
  options,
  isPending,
  isAssigned,
  onToggle,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  query: string;
  onQueryChange: (next: string) => void;
  isFetching: boolean;
  options: SuggestedReviewerFilterOption[];
  isPending: boolean;
  isAssigned: (option: AvailableSuggestedReviewer) => boolean;
  onToggle: (option: AvailableSuggestedReviewer) => void;
}) {
  return (
    <Popover.Root modal open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger>
        <button
          type="button"
          aria-label="Add suggested reviewer"
          className="flex h-5 items-center gap-1 rounded-(--radius-1) px-1 text-[11px] text-gray-10 transition-colors hover:bg-(--gray-3) hover:text-gray-12"
        >
          <PlusIcon size={11} />
          Add
        </button>
      </Popover.Trigger>
      <Popover.Content
        align="end"
        side="bottom"
        sideOffset={6}
        className="min-w-[280px] max-w-[320px] p-2"
      >
        <PeoplePickerList
          searchQuery={query}
          onSearchQueryChange={onQueryChange}
          searchPlaceholder="Filter users…"
          people={options}
          isFetching={isFetching}
          autoFocus
          renderRow={(option) => {
            const assigned = isAssigned(option);
            const displayName = getSuggestedReviewerDisplayName(option);
            return (
              <button
                type="button"
                disabled={isPending}
                className="flex w-full items-start justify-between rounded-(--radius-1) px-1 py-1 text-left text-[13px] text-gray-12 transition-colors hover:bg-(--gray-3) focus-visible:bg-(--gray-3) focus-visible:outline-none disabled:opacity-60"
                onClick={() => onToggle(option)}
              >
                <Flex align="center" gap="2" className="min-w-0">
                  {option.github_login ? (
                    <SuggestedReviewerAvatar
                      githubLogin={option.github_login}
                      size="sm"
                    />
                  ) : null}
                  <Flex direction="column" gap="0" className="min-w-0">
                    <Text className="truncate text-[12px]">{displayName}</Text>
                    {option.email ? (
                      <Text className="truncate text-[11px] text-gray-10">
                        {option.email}
                      </Text>
                    ) : null}
                  </Flex>
                </Flex>
                <span
                  className="flex h-4 w-4 shrink-0 items-center justify-center text-gray-12"
                  aria-hidden
                >
                  {assigned ? <CheckIcon size={12} weight="bold" /> : null}
                </span>
              </button>
            );
          }}
        />
      </Popover.Content>
    </Popover.Root>
  );
}

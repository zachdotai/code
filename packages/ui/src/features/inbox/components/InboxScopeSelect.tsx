import {
  AsteriskSimpleIcon,
  CaretDownIcon,
  CheckIcon,
} from "@phosphor-icons/react";
import {
  INBOX_SCOPE_ENTIRE_PROJECT,
  INBOX_SCOPE_FOR_YOU,
  parseTeammateInboxScope,
  teammateInboxScope,
} from "@posthog/core/inbox/reportMembership";
import { PeoplePickerList } from "@posthog/ui/features/inbox/components/PeoplePickerList";
import { ReviewerAvatar } from "@posthog/ui/features/inbox/components/ReviewerAvatar";
import {
  getSuggestedReviewerDisplayName,
  type SuggestedReviewerFilterOption,
} from "@posthog/ui/features/inbox/filterOptions";
import { useInboxScopeOptions } from "@posthog/ui/features/inbox/hooks/useInboxScopeOptions";
import { useReviewerPickerOptions } from "@posthog/ui/features/inbox/hooks/useReviewerPickerOptions";
import { useInboxReviewerScopeStore } from "@posthog/ui/features/inbox/stores/inboxReviewerScopeStore";
import { useDebounce } from "@posthog/ui/primitives/hooks/useDebounce";
import { Popover, SegmentedControl } from "@radix-ui/themes";
import { useMemo, useState } from "react";

/**
 * Two-segment scope toggle. Left segment is "For you"; right segment shows
 * either "Entire project" or the currently-selected teammate's name, and opens
 * a searchable, virtualized list of "Entire project + each teammate" when
 * clicked.
 *
 * The list lives inside a Popover whose content only mounts while open, so the
 * underlying people query re-fetches on every open (it previously stayed
 * mounted and went stale until the 60s background refetch). Search is
 * server-side; an empty result surfaces a hint to connect a GitHub profile.
 *
 * Segments share equal width – Radix Themes' SegmentedControl indicator is
 * hardcoded to equal-width math (`width: calc(100% / N)` + percentage
 * translate), so a fit-content override desyncs the pill from the items.
 * Keeping the default avoids a custom toggle just for this surface.
 */

type SegmentValue = "for-you" | "entire-project";

export function InboxScopeSelect() {
  const scope = useInboxReviewerScopeStore((s) => s.scope);
  const setScope = useInboxReviewerScopeStore((s) => s.setScope);
  const [open, setOpen] = useState(false);
  // Base (always-on) list, used to resolve the selected teammate's name for the
  // segment label even while the dropdown is closed.
  const { teammateOptions } = useInboxScopeOptions();

  const selectedTeammateUuid = parseTeammateInboxScope(scope);

  const selectedTeammate = useMemo(() => {
    if (!selectedTeammateUuid) return null;
    return (
      teammateOptions.find((option) => option.uuid === selectedTeammateUuid) ??
      null
    );
  }, [selectedTeammateUuid, teammateOptions]);

  const segmentValue: SegmentValue =
    scope === INBOX_SCOPE_FOR_YOU ? "for-you" : "entire-project";

  const rightLabel = selectedTeammate
    ? getSuggestedReviewerDisplayName(selectedTeammate)
    : "Entire project";

  const handleSegmentValueChange = (next: string) => {
    if (next === "for-you") {
      setScope(INBOX_SCOPE_FOR_YOU);
      setOpen(false);
    }
  };

  const selectEntireProject = () => {
    setScope(INBOX_SCOPE_ENTIRE_PROJECT);
    setOpen(false);
  };

  const selectTeammate = (teammate: SuggestedReviewerFilterOption) => {
    setScope(teammateInboxScope(teammate.uuid));
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor>
        <div className="ml-2 inline-flex">
          <SegmentedControl.Root
            value={segmentValue}
            size="1"
            onValueChange={handleSegmentValueChange}
            aria-label="Inbox scope"
          >
            <SegmentedControl.Item value="for-you">
              For you
            </SegmentedControl.Item>
            <SegmentedControl.Item
              value="entire-project"
              onClick={() => setOpen(true)}
              aria-haspopup="listbox"
              aria-expanded={open}
            >
              <span className="inline-flex items-center gap-1.5">
                {rightLabel}
                <CaretDownIcon
                  size={10}
                  weight="bold"
                  className="text-muted-foreground"
                />
              </span>
            </SegmentedControl.Item>
          </SegmentedControl.Root>
        </div>
      </Popover.Anchor>
      <Popover.Content
        align="end"
        side="bottom"
        sideOffset={6}
        className="min-w-[240px] max-w-[320px] p-2"
      >
        <ScopePickerContent
          selectedTeammateUuid={selectedTeammateUuid}
          isEntireProjectSelected={scope === INBOX_SCOPE_ENTIRE_PROJECT}
          onSelectEntireProject={selectEntireProject}
          onSelectTeammate={selectTeammate}
        />
      </Popover.Content>
    </Popover.Root>
  );
}

function ScopePickerContent({
  selectedTeammateUuid,
  isEntireProjectSelected,
  onSelectEntireProject,
  onSelectTeammate,
}: {
  selectedTeammateUuid: string | null;
  isEntireProjectSelected: boolean;
  onSelectEntireProject: () => void;
  onSelectTeammate: (teammate: SuggestedReviewerFilterOption) => void;
}) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 200);
  const { options, isFetching } = useReviewerPickerOptions({
    query: debouncedSearch,
    enabled: true,
  });

  // "For you" already covers the current user, so the teammate list excludes
  // them.
  const teammates = useMemo(
    () => options.filter((option) => !option.isMe),
    [options],
  );

  return (
    <PeoplePickerList
      searchQuery={search}
      onSearchQueryChange={setSearch}
      people={teammates}
      isFetching={isFetching}
      autoFocus
      leadingSlot={
        <button
          type="button"
          onClick={onSelectEntireProject}
          className="flex w-full items-center gap-2 rounded-(--radius-1) px-1 py-1 text-left text-[13px] text-gray-12 transition-colors hover:bg-(--gray-3) focus-visible:bg-(--gray-3) focus-visible:outline-none"
        >
          <span
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-(--gray-8) border-dashed text-gray-10"
            aria-hidden
          >
            <AsteriskSimpleIcon size={12} weight="bold" />
          </span>
          <span className="min-w-0 flex-1 truncate">Entire project</span>
          <span
            className="flex h-4 w-4 shrink-0 items-center justify-center text-gray-12"
            aria-hidden
          >
            {isEntireProjectSelected ? (
              <CheckIcon size={12} weight="bold" />
            ) : null}
          </span>
        </button>
      }
      renderRow={(teammate) => {
        const displayName = getSuggestedReviewerDisplayName(teammate);
        const selected = teammate.uuid === selectedTeammateUuid;
        return (
          <button
            type="button"
            onClick={() => onSelectTeammate(teammate)}
            className="flex w-full items-center gap-2 rounded-(--radius-1) px-1 py-1 text-left text-[13px] text-gray-12 transition-colors hover:bg-(--gray-3) focus-visible:bg-(--gray-3) focus-visible:outline-none"
          >
            <ReviewerAvatar
              seed={teammate.uuid}
              name={teammate.name}
              email={teammate.email}
            />
            <span className="min-w-0 flex-1 truncate">{displayName}</span>
            <span
              className="flex h-4 w-4 shrink-0 items-center justify-center text-gray-12"
              aria-hidden
            >
              {selected ? <CheckIcon size={12} weight="bold" /> : null}
            </span>
          </button>
        );
      }}
    />
  );
}

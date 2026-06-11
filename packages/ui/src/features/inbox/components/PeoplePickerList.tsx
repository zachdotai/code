import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { buildPostHogUrl } from "@posthog/core/settings/posthogUrl";
import { useAuthStateValue } from "@posthog/ui/features/auth/store";
import type { SuggestedReviewerFilterOption } from "@posthog/ui/features/inbox/filterOptions";
import { openExternalUrl } from "@posthog/ui/shell/openExternal";
import { Flex, Spinner, Text } from "@radix-ui/themes";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type ReactNode, useRef } from "react";

const ESTIMATED_ROW_HEIGHT = 44;
const OVERSCAN = 8;

interface PeoplePickerListProps {
  searchQuery: string;
  onSearchQueryChange: (next: string) => void;
  searchPlaceholder?: string;
  /** People to render in the (virtualized) list. */
  people: SuggestedReviewerFilterOption[];
  isFetching: boolean;
  renderRow: (
    person: SuggestedReviewerFilterOption,
    index: number,
  ) => ReactNode;
  /**
   * Optional non-person row pinned above the searchable list (e.g. an "Entire
   * project" option). Hidden while the user is searching.
   */
  leadingSlot?: ReactNode;
  autoFocus?: boolean;
}

/**
 * Searchable, virtualized people list shared by the inbox reviewer and scope
 * pickers. Only the visible rows are mounted, so it stays responsive for large
 * orgs. Search is driven by the caller (server-side); when there are no
 * results it surfaces the "ask them to connect GitHub" hint.
 */
export function PeoplePickerList({
  searchQuery,
  onSearchQueryChange,
  searchPlaceholder = "Search people…",
  people,
  isFetching,
  renderRow,
  leadingSlot,
  autoFocus,
}: PeoplePickerListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isSearching = searchQuery.trim().length > 0;

  const virtualizer = useVirtualizer({
    count: people.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: OVERSCAN,
    getItemKey: (index) => people[index]?.uuid ?? index,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const isEmpty = people.length === 0;

  return (
    <Flex direction="column" gap="2">
      <Flex
        align="center"
        gap="2"
        px="2"
        py="1"
        className="rounded-(--radius-2) border border-(--gray-6) bg-(--color-background)"
      >
        <MagnifyingGlassIcon size={12} className="shrink-0 text-gray-10" />
        <input
          type="text"
          // biome-ignore lint/a11y/noAutofocus: the picker opens from an explicit user action
          autoFocus={autoFocus}
          placeholder={searchPlaceholder}
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-gray-12 outline-none placeholder:text-(--gray-9)"
        />
        {isFetching && !isEmpty ? <Spinner size="1" /> : null}
      </Flex>

      {leadingSlot && !isSearching ? leadingSlot : null}

      {isEmpty ? (
        isFetching ? (
          <Flex align="center" justify="center" py="3">
            <Spinner size="1" />
          </Flex>
        ) : (
          <PeoplePickerEmptyState />
        )
      ) : (
        <div
          ref={scrollRef}
          className="max-h-[280px] overflow-y-auto"
          style={{ scrollbarGutter: "stable" }}
        >
          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: "relative",
              width: "100%",
            }}
          >
            {virtualItems.map((virtualItem) => {
              const person = people[virtualItem.index];
              if (!person) return null;
              return (
                <div
                  key={virtualItem.key}
                  ref={virtualizer.measureElement}
                  data-index={virtualItem.index}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  {renderRow(person, virtualItem.index)}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Flex>
  );
}

function PeoplePickerEmptyState() {
  const cloudRegion = useAuthStateValue((state) => state.cloudRegion);
  const integrationsUrl = buildPostHogUrl("/settings/user", cloudRegion);

  return (
    <div className="px-1 py-2">
      <Text as="p" className="text-[12px] text-gray-11 leading-snug">
        Someone not showing up here?
      </Text>
      <Text as="p" className="text-[12px] text-gray-10 leading-snug">
        Ask them to{" "}
        {integrationsUrl ? (
          <button
            type="button"
            onClick={() => openExternalUrl(integrationsUrl)}
            className="text-(--accent-11) underline hover:text-(--accent-12)"
          >
            connect their GitHub profile with PostHog
          </button>
        ) : (
          "connect their GitHub profile with PostHog"
        )}
        .
      </Text>
    </div>
  );
}

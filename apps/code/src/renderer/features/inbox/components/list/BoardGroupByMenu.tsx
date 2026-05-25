import {
  type InboxBoardGroupBy,
  useInboxSignalsFilterStore,
} from "@features/inbox/stores/inboxSignalsFilterStore";
import { boardGroupByLabel } from "@features/inbox/utils/inboxBoardGrouping";
import { CaretDownIcon, RowsIcon } from "@phosphor-icons/react";
import { DropdownMenu, Text } from "@radix-ui/themes";

const OPTIONS: InboxBoardGroupBy[] = ["actionability", "priority", "status"];

export function BoardGroupByMenu() {
  const groupBy = useInboxSignalsFilterStore((s) => s.boardGroupBy);
  const setGroupBy = useInboxSignalsFilterStore((s) => s.setBoardGroupBy);
  const viewMode = useInboxSignalsFilterStore((s) => s.viewMode);

  if (viewMode !== "board") return null;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <button
          type="button"
          aria-label="Group board by"
          className="flex h-6 items-center gap-1 rounded-sm px-1.5 text-(--gray-11) text-[11px] transition-colors hover:bg-gray-3 hover:text-(--gray-12)"
        >
          <RowsIcon size={12} />
          <Text className="text-[11px]">
            Group by: {boardGroupByLabel(groupBy)}
          </Text>
          <CaretDownIcon size={10} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" size="1">
        <DropdownMenu.Label>Group by</DropdownMenu.Label>
        {OPTIONS.map((option) => (
          <DropdownMenu.CheckboxItem
            key={option}
            checked={groupBy === option}
            onCheckedChange={() => setGroupBy(option)}
          >
            {boardGroupByLabel(option)}
          </DropdownMenu.CheckboxItem>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

import {
  type InboxViewMode,
  useInboxSignalsFilterStore,
} from "@features/inbox/stores/inboxSignalsFilterStore";
import { KanbanIcon, ListBulletsIcon } from "@phosphor-icons/react";
import { Tooltip } from "@radix-ui/themes";
import type { ReactNode } from "react";

interface OptionButtonProps {
  mode: InboxViewMode;
  active: boolean;
  label: string;
  icon: ReactNode;
  onSelect: (mode: InboxViewMode) => void;
}

function OptionButton({
  mode,
  active,
  label,
  icon,
  onSelect,
}: OptionButtonProps) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={() => onSelect(mode)}
        className={`flex h-6 w-6 items-center justify-center rounded-sm transition-colors ${
          active
            ? "bg-gray-3 text-(--gray-12)"
            : "text-gray-10 hover:bg-gray-3 hover:text-gray-12"
        }`}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

export function ViewModeToggle() {
  const viewMode = useInboxSignalsFilterStore((s) => s.viewMode);
  const setViewMode = useInboxSignalsFilterStore((s) => s.setViewMode);

  return (
    <div className="ml-0.5 flex items-center rounded-sm border border-(--gray-5) p-[1px]">
      <OptionButton
        mode="list"
        active={viewMode === "list"}
        label="View as list"
        icon={<ListBulletsIcon size={14} />}
        onSelect={setViewMode}
      />
      <OptionButton
        mode="board"
        active={viewMode === "board"}
        label="View as board"
        icon={<KanbanIcon size={14} />}
        onSelect={setViewMode}
      />
    </div>
  );
}

import { Brain } from "@phosphor-icons/react";
import { Tooltip } from "@radix-ui/themes";
import { useNavigationStore } from "@stores/navigationStore";
import { useMemoryEntries } from "../hooks/useMemoryEntries";

/**
 * Compact chip shown in the task header to surface that the agent has the
 * user's memory available. Click → jumps to Work mode Memory.
 */
export function MemoryIndicator() {
  const { data: entries = [] } = useMemoryEntries();
  const setMode = useNavigationStore((s) => s.setMode);
  const navigateToWorkMemory = useNavigationStore(
    (s) => s.navigateToWorkMemory,
  );

  const peopleCount = entries.filter((e) => e.type === "person").length;
  const totalCount = entries.length;
  if (totalCount === 0) return null;

  const tooltip =
    peopleCount > 0
      ? `Memory loaded: ${peopleCount} ${peopleCount === 1 ? "person" : "people"}, ${totalCount} entries total. Click to manage.`
      : `Memory loaded: ${totalCount} ${totalCount === 1 ? "entry" : "entries"}. Click to manage.`;

  const handleClick = () => {
    setMode("work");
    navigateToWorkMemory();
  };

  return (
    <Tooltip content={tooltip} side="bottom" delayDuration={200}>
      <button
        type="button"
        onClick={handleClick}
        className="no-drag flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-gray-10 hover:bg-gray-3 hover:text-gray-12"
      >
        <Brain size={12} />
        {peopleCount > 0 ? peopleCount : totalCount}
      </button>
    </Tooltip>
  );
}

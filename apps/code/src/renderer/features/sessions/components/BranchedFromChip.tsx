import { Tooltip } from "@components/ui/Tooltip";
import { getAuthenticatedClient } from "@features/auth/hooks/authClient";
import { useBranchLineage } from "@features/sessions/stores/branchLineageStore";
import { GitFork } from "@phosphor-icons/react";
import { useNavigationStore } from "@stores/navigationStore";
import { logger } from "@utils/logger";

const log = logger.scope("branched-from-chip");

interface BranchedFromChipProps {
  taskId: string;
}

/** Chip on a branched task linking back to the task it came from. */
export function BranchedFromChip({ taskId }: BranchedFromChipProps) {
  const lineage = useBranchLineage(taskId);
  const navigateToTask = useNavigationStore((s) => s.navigateToTask);

  if (!lineage) return null;

  const label = lineage.parentTaskNumber
    ? `#${lineage.parentTaskNumber}`
    : "parent";

  const handleClick = async () => {
    const client = await getAuthenticatedClient();
    if (!client) return;
    try {
      const parent = await client.getTask(lineage.parentTaskId);
      navigateToTask(parent);
    } catch (error) {
      log.warn("Failed to open parent task", { error });
    }
  };

  return (
    <Tooltip content={`Branched from "${lineage.parentTaskTitle}"`}>
      <button
        type="button"
        onClick={handleClick}
        className="no-drag flex shrink-0 items-center gap-1 rounded-full border border-(--gray-5) bg-(--gray-2) px-2 py-[2px] text-(--gray-11) text-[11px] hover:bg-(--gray-3)"
      >
        <GitFork size={10} className="shrink-0" />
        Branched from {label}
      </button>
    </Tooltip>
  );
}

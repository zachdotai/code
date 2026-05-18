import { useSetupStore } from "@features/setup/stores/setupStore";
import type { DiscoveredTask } from "@features/setup/types";
import {
  CATEGORY_CONFIG,
  FALLBACK_CATEGORY_CONFIG,
} from "@features/setup/utils/categoryConfig";
import { Chip } from "@posthog/quill";
import { Tooltip } from "@radix-ui/themes";
import { useState } from "react";

const COLLAPSED_LIMIT = 4;

interface SuggestedTaskChipsProps {
  onSelect: (task: DiscoveredTask) => void;
}

export function SuggestedTaskChips({ onSelect }: SuggestedTaskChipsProps) {
  const discoveredTasks = useSetupStore((s) => s.discoveredTasks);
  const [expanded, setExpanded] = useState(false);

  if (discoveredTasks.length === 0) return null;

  const visible =
    expanded || discoveredTasks.length <= COLLAPSED_LIMIT
      ? discoveredTasks
      : discoveredTasks.slice(0, COLLAPSED_LIMIT);
  const hiddenCount = discoveredTasks.length - visible.length;

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {visible.map((task) => (
        <SuggestedTaskChip key={task.id} task={task} onSelect={onSelect} />
      ))}
      {hiddenCount > 0 && (
        <Chip
          size="sm"
          onClick={() => setExpanded(true)}
          className="cursor-pointer! whitespace-nowrap text-(--gray-11)"
        >
          +{hiddenCount} more
        </Chip>
      )}
    </div>
  );
}

function SuggestedTaskChip({
  task,
  onSelect,
}: {
  task: DiscoveredTask;
  onSelect: (task: DiscoveredTask) => void;
}) {
  const config = CATEGORY_CONFIG[task.category] ?? FALLBACK_CATEGORY_CONFIG;
  const TaskIcon = config.icon;

  return (
    <Tooltip content={task.description}>
      <Chip
        size="sm"
        onClick={() => onSelect(task)}
        className="max-w-[220px] cursor-pointer! gap-1.5 whitespace-nowrap pl-2"
      >
        <TaskIcon
          size={14}
          weight="duotone"
          color={`var(--${config.color}-9)`}
        />
        <span className="min-w-0 truncate">{task.title}</span>
      </Chip>
    </Tooltip>
  );
}

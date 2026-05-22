import { Tooltip } from "@components/ui/Tooltip";
import { GitDialog } from "@features/git-interaction/components/GitInteractionDialogs";
import { branchTask } from "@features/sessions/service/branchTask";
import { useCreateTask } from "@features/tasks/hooks/useTasks";
import type { Workspace } from "@main/services/workspace/schemas";
import { ChatCircleText, Code, GitFork } from "@phosphor-icons/react";
import { CheckIcon } from "@radix-ui/react-icons";
import { Box, Flex, Text } from "@radix-ui/themes";
import type { Task } from "@shared/types";
import { useNavigationStore } from "@stores/navigationStore";
import type { ReactNode } from "react";
import { useState } from "react";

type BranchMode = "context" | "context+code";

interface BranchModeOptionProps {
  icon: ReactNode;
  label: string;
  description: string;
  selected: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onSelect: () => void;
}

function BranchModeOption({
  icon,
  label,
  description,
  selected,
  disabled = false,
  disabledReason,
  onSelect,
}: BranchModeOptionProps) {
  const row = (
    <Box
      role="button"
      onClick={() => !disabled && onSelect()}
      className={`flex items-start justify-between gap-2 rounded-(--radius-2) border px-[8px] py-[6px] ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      } ${selected ? "border-(--accent-7) bg-(--accent-3)" : "border-(--gray-6) bg-(--gray-2)"}`}
    >
      <Flex direction="column" gap="1" className="min-w-0">
        <Flex align="center" gap="2">
          {icon}
          <Text className="font-medium text-[13px]">{label}</Text>
        </Flex>
        <Text color="gray" className="text-[12px]">
          {description}
        </Text>
      </Flex>
      {selected && <CheckIcon className="mt-[2px] shrink-0" />}
    </Box>
  );

  if (disabled && disabledReason) {
    return <Tooltip content={disabledReason}>{row}</Tooltip>;
  }
  return row;
}

interface BranchTaskDialogProps {
  task: Task;
  workspace: Workspace | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BranchTaskDialog({
  task,
  workspace,
  open,
  onOpenChange,
}: BranchTaskDialogProps) {
  const [mode, setMode] = useState<BranchMode>("context");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { invalidateTasks } = useCreateTask();
  const navigateToTask = useNavigationStore((s) => s.navigateToTask);

  const handleSubmit = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await branchTask(
        { task, workspace, mode: "context" },
        (newTask) => {
          invalidateTasks(newTask);
          navigateToTask(newTask);
        },
      );
      if (result.success) {
        onOpenChange(false);
      } else {
        setError(result.error ?? "Failed to branch task");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <GitDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={<GitFork size={14} />}
      title="Branch task"
      error={error}
      buttonLabel="Branch"
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit}
      maxWidth="420px"
    >
      <Text color="gray" className="text-[13px]">
        Start a new task from this moment. It begins with a summary of the
        current conversation as context.
      </Text>

      <Flex direction="column" gap="2">
        <BranchModeOption
          icon={<ChatCircleText size={14} />}
          label="Branch with context"
          description="New task starts from a clean tree with the summarised conversation."
          selected={mode === "context"}
          onSelect={() => setMode("context")}
        />
        <BranchModeOption
          icon={<Code size={14} />}
          label="Branch with context + code"
          description="Also carry over the current code changes."
          selected={mode === "context+code"}
          disabled
          disabledReason="Available in a future update"
          onSelect={() => setMode("context+code")}
        />
      </Flex>
    </GitDialog>
  );
}

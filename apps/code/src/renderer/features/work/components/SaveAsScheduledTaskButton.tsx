import { CalendarPlus, Spinner } from "@phosphor-icons/react";
import { Tooltip } from "@radix-ui/themes";
import { useSaveChatAsScheduledTask } from "../hooks/useSaveChatAsScheduledTask";
import { useWorkThreadsStore } from "../stores/workThreadsStore";

interface SaveAsScheduledTaskButtonProps {
  taskId: string;
}

/**
 * Header action available on Work threads. Summarises the current chat into a
 * recurring scheduled-task prompt via the LLM gateway and drops the user on
 * the scheduled-task editor with the result pre-filled.
 */
export function SaveAsScheduledTaskButton({
  taskId,
}: SaveAsScheduledTaskButtonProps) {
  const isWorkThread = useWorkThreadsStore((s) => s.isThread(taskId));
  const { saveAsScheduledTask, isSaving, canSave } =
    useSaveChatAsScheduledTask(taskId);

  if (!isWorkThread || !canSave) return null;

  return (
    <Tooltip
      content="Save chat as a scheduled task"
      side="bottom"
      delayDuration={200}
    >
      <button
        type="button"
        onClick={saveAsScheduledTask}
        disabled={isSaving}
        className="no-drag flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-gray-10 hover:bg-gray-3 hover:text-gray-12 disabled:opacity-50"
      >
        {isSaving ? <Spinner size={12} /> : <CalendarPlus size={12} />}
      </button>
    </Tooltip>
  );
}

import { Globe, Lightning, Plus, Terminal } from "@phosphor-icons/react";
import { openTaskInput } from "@posthog/ui/router/useOpenTask";
import { Popover } from "@radix-ui/themes";
import { type ReactNode, useCallback } from "react";
import { Combobox } from "../../../primitives/combobox/Combobox";
import { useCommandCenterStore } from "../commandCenterStore";
import { useAvailableTasks } from "../hooks/useAvailableTasks";

interface TaskSelectorProps {
  cellIndex: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewTask?: () => void;
  onNewTerminal?: () => void;
  onNewBrowser?: () => void;
  onBrainrot?: () => void;
  children: ReactNode;
}

export function TaskSelector({
  cellIndex,
  open,
  onOpenChange,
  onNewTask,
  onNewTerminal,
  onNewBrowser,
  onBrainrot,
  children,
}: TaskSelectorProps) {
  const availableTasks = useAvailableTasks();
  const assignTask = useCommandCenterStore((s) => s.assignTask);

  const handleSelect = useCallback(
    (taskId: string) => {
      assignTask(cellIndex, taskId);
      onOpenChange(false);
    },
    [assignTask, cellIndex, onOpenChange],
  );

  const closeAnd = useCallback(
    (action: () => void) => () => {
      onOpenChange(false);
      action();
    },
    [onOpenChange],
  );

  return (
    <Combobox.Root
      open={open}
      onOpenChange={onOpenChange}
      value=""
      onValueChange={handleSelect}
      size="1"
    >
      <Popover.Trigger>{children}</Popover.Trigger>
      <Combobox.Content
        items={availableTasks}
        getValue={(task) => task.title}
        side="bottom"
        align="center"
        sideOffset={4}
        className="min-w-[240px]"
      >
        {({ filtered, hasMore, moreCount }) => (
          <>
            <Combobox.Input placeholder="Search tasks..." />
            <Combobox.Empty>No matching tasks</Combobox.Empty>
            {filtered.map((task) => (
              <Combobox.Item
                key={task.id}
                value={task.id}
                textValue={task.title}
              >
                {task.title}
              </Combobox.Item>
            ))}
            {hasMore && (
              <div className="combobox-label">
                {moreCount} more {moreCount === 1 ? "task" : "tasks"}; type to
                filter
              </div>
            )}
            <Combobox.Footer>
              <button
                type="button"
                className="combobox-footer-button"
                onClick={closeAnd(onNewTask ?? openTaskInput)}
              >
                <Plus size={11} weight="bold" />
                New task
              </button>
              {onNewTerminal && (
                <button
                  type="button"
                  className="combobox-footer-button"
                  onClick={closeAnd(onNewTerminal)}
                >
                  <Terminal size={11} weight="bold" />
                  Terminal
                </button>
              )}
              {onNewBrowser && (
                <button
                  type="button"
                  className="combobox-footer-button"
                  onClick={closeAnd(onNewBrowser)}
                >
                  <Globe size={11} weight="bold" />
                  Browser
                </button>
              )}
              {onBrainrot && (
                <button
                  type="button"
                  className="combobox-footer-button"
                  onClick={closeAnd(onBrainrot)}
                >
                  <Lightning size={11} weight="bold" />
                  Brainrot
                </button>
              )}
            </Combobox.Footer>
          </>
        )}
      </Combobox.Content>
    </Combobox.Root>
  );
}

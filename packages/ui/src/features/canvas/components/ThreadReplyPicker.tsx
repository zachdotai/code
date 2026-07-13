import { CaretDownIcon, XIcon } from "@phosphor-icons/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@posthog/quill";
import type { Task } from "@posthog/shared/domain-types";
import { TaskTabIcon } from "@posthog/ui/features/browser-tabs/TaskTabIcon";
import { useChannelFeed } from "@posthog/ui/features/canvas/hooks/useChannelFeed";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useBackendChannel } from "@posthog/ui/features/canvas/hooks/useTaskChannels";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";

export interface ThreadReply {
  label: string;
  href: string;
}

// Picks the thread (a task) a fake message replies to. Same task list as the
// reference picker — this channel's tasks first, then all others.
export function ThreadReplyPicker({
  channelId,
  value,
  onChange,
}: {
  channelId: string;
  value: ThreadReply | null;
  onChange: (value: ThreadReply | null) => void;
}) {
  const { channels } = useChannels();
  const channelName = channels.find((c) => c.id === channelId)?.name;
  const { channel: backendChannel } = useBackendChannel(channelName);
  const { tasks: channelTasks } = useChannelFeed(backendChannel?.id);
  const { data: allTasks = [] } = useTasks();

  const channelTaskIds = new Set(channelTasks.map((t) => t.id));
  const otherTasks = allTasks.filter((t) => !channelTaskIds.has(t.id));

  const taskItem = (t: Task) => (
    <DropdownMenuItem
      key={t.id}
      onClick={() =>
        onChange({
          label: t.title || "Untitled task",
          href: `/website/${channelId}/tasks/${t.id}`,
        })
      }
    >
      <TaskTabIcon task={t} size={14} />
      <span className="truncate">{t.title || "Untitled task"}</span>
    </DropdownMenuItem>
  );

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm" className="max-w-full">
              <span className="truncate">
                {value ? value.label : "Choose a thread…"}
              </span>
              <CaretDownIcon size={12} className="ms-auto shrink-0" />
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="w-72">
          {channelTasks.length === 0 && otherTasks.length === 0 ? (
            <DropdownMenuItem disabled>No tasks yet</DropdownMenuItem>
          ) : (
            <>
              {channelTasks.length > 0 && (
                <DropdownMenuGroup>
                  <DropdownMenuLabel>This channel</DropdownMenuLabel>
                  {channelTasks.map(taskItem)}
                </DropdownMenuGroup>
              )}
              {otherTasks.length > 0 && (
                <DropdownMenuGroup>
                  {channelTasks.length > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel>Other tasks</DropdownMenuLabel>
                  {otherTasks.map(taskItem)}
                </DropdownMenuGroup>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {value && (
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Clear reply"
          onClick={() => onChange(null)}
        >
          <XIcon size={13} />
        </Button>
      )}
    </div>
  );
}

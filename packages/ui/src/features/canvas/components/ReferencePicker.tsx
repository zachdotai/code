import { ArrowSquareOutIcon, LinkIcon } from "@phosphor-icons/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@posthog/quill";
import type { Task } from "@posthog/shared/domain-types";
import { TaskTabIcon } from "@posthog/ui/features/browser-tabs/TaskTabIcon";
import { useChannelFeed } from "@posthog/ui/features/canvas/hooks/useChannelFeed";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useDashboards } from "@posthog/ui/features/canvas/hooks/useDashboards";
import { useBackendChannel } from "@posthog/ui/features/canvas/hooks/useTaskChannels";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import { File, Shapes, SquircleDashed } from "lucide-react";

// A menu for inserting an in-app reference (canvas / channel / task / this
// channel's CONTEXT.md) as a deep link. Canvas / Channels / Tasks are submenus;
// CONTEXT.md is a direct item.
export function ReferencePicker({
  channelId,
  onInsert,
}: {
  channelId: string;
  onInsert: (label: string, href: string) => void;
}) {
  const { channels } = useChannels();
  const channelName = channels.find((c) => c.id === channelId)?.name;
  const { channel: backendChannel } = useBackendChannel(channelName);
  const { dashboards } = useDashboards(channelId);
  const { tasks: channelTasks } = useChannelFeed(backendChannel?.id);
  const { data: allTasks = [] } = useTasks();

  // Every task is referenceable: this channel's tasks first, then the rest.
  const channelTaskIds = new Set(channelTasks.map((t) => t.id));
  const otherTasks = allTasks.filter((t) => !channelTaskIds.has(t.id));

  const taskItem = (t: Task) => (
    <DropdownMenuItem
      key={t.id}
      onClick={() =>
        onInsert(
          t.title || "Untitled task",
          `/website/${channelId}/tasks/${t.id}`,
        )
      }
    >
      <TaskTabIcon task={t} size={14} />
      <span className="truncate">{t.title || "Untitled task"}</span>
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="xs">
            <LinkIcon size={13} />
            Insert reference
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Shapes size={14} className="text-muted-foreground" />
            Canvas
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent side="right" sideOffset={4} className="w-56">
            {dashboards.length === 0 ? (
              <DropdownMenuItem disabled>No canvases yet</DropdownMenuItem>
            ) : (
              dashboards.map((d) => (
                <DropdownMenuItem
                  key={d.id}
                  onClick={() =>
                    onInsert(d.name, `/website/${channelId}/dashboards/${d.id}`)
                  }
                >
                  <Shapes size={14} className="text-muted-foreground" />
                  {d.name}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <SquircleDashed size={14} className="text-muted-foreground" />
            Channels
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent side="right" sideOffset={4} className="w-56">
            {channels.map((c) => (
              <DropdownMenuItem
                key={c.id}
                onClick={() => onInsert(`#${c.name}`, `/website/${c.id}`)}
              >
                <SquircleDashed size={14} className="text-muted-foreground" />
                {c.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ArrowSquareOutIcon size={14} className="text-muted-foreground" />
            Tasks
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent side="right" sideOffset={4} className="w-64">
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
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuItem
          onClick={() =>
            onInsert("CONTEXT.md", `/website/${channelId}/context`)
          }
        >
          <File size={14} className="text-muted-foreground" />
          This channel's CONTEXT.md
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

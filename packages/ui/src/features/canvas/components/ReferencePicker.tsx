import { ArrowSquareOutIcon, LinkIcon } from "@phosphor-icons/react";
import {
  Badge,
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
import { useInboxReports } from "@posthog/ui/features/inbox/hooks/useInboxReports";
import {
  type PrDiffStats,
  usePrDiffStatsBatch,
} from "@posthog/ui/features/inbox/hooks/usePrDiffStatsBatch";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import { File, Inbox, Shapes, SquircleDashed } from "lucide-react";

// The inbox item's PR state as a compact badge + diff stats, so you can tell a
// merged report from an open one when picking.
function PrStatusBadge({ pr }: { pr: PrDiffStats }) {
  const { label, variant } = pr.merged
    ? ({ label: "Merged", variant: "default" } as const)
    : pr.draft
      ? ({ label: "Draft", variant: "default" } as const)
      : pr.state === "closed"
        ? ({ label: "Closed", variant: "destructive" } as const)
        : ({ label: "PR", variant: "info" } as const);
  return (
    <span className="ms-auto flex shrink-0 items-center gap-1">
      <Badge variant={variant}>{label}</Badge>
      <span className="text-[11px] text-muted-foreground">
        <span className="text-green-11">+{pr.additions}</span>{" "}
        <span className="text-red-11">-{pr.deletions}</span>
      </span>
    </span>
  );
}

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
  const { data: inbox } = useInboxReports();
  const inboxReports = inbox?.results ?? [];
  const { data: prStats } = usePrDiffStatsBatch(
    inboxReports
      .map((r) => r.implementation_pr_url)
      .filter((u): u is string => !!u),
  );

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

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Inbox size={14} className="text-muted-foreground" />
            Inbox
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent side="right" sideOffset={4} className="w-64">
            {inboxReports.length === 0 ? (
              <DropdownMenuItem disabled>No inbox items</DropdownMenuItem>
            ) : (
              inboxReports.map((r) => {
                const pr = r.implementation_pr_url
                  ? prStats?.[r.implementation_pr_url]
                  : undefined;
                return (
                  <DropdownMenuItem
                    key={r.id}
                    onClick={() =>
                      onInsert(
                        r.title || "Untitled report",
                        `/code/inbox/reports/${r.id}`,
                      )
                    }
                  >
                    <Inbox size={14} className="text-muted-foreground" />
                    <span className="truncate">
                      {r.title || "Untitled report"}
                    </span>
                    {pr && <PrStatusBadge pr={pr} />}
                  </DropdownMenuItem>
                );
              })
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

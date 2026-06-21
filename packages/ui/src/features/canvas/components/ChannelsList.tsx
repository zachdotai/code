import {
  ArchiveIcon,
  CaretDownIcon,
  ChartBarIcon,
  ChartLineIcon,
  CodeIcon,
  DotsThreeIcon,
  FileIcon,
  FileTextIcon,
  FolderIcon,
  HashIcon,
  PencilSimpleIcon,
  PlusIcon,
  StarIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { DashboardSummary } from "@posthog/core/canvas/dashboardSchemas";
import {
  Button,
  ButtonGroup,
  Collapsible,
  CollapsibleContent,
  CollapsibleHeader,
  CollapsibleTrigger,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  cn,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MenuLabel,
  Separator,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@posthog/quill";

import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import type { Task } from "@posthog/shared/domain-types";
import { useArchivedTaskIds } from "@posthog/ui/features/archive/useArchivedTaskIds";
import { useArchiveTask } from "@posthog/ui/features/archive/useArchiveTask";
import { CreateChannelModal } from "@posthog/ui/features/canvas/components/CreateChannelModal";
import { CanvasTemplateList } from "@posthog/ui/features/canvas/components/NewCanvasMenu";
import { RenameChannelModal } from "@posthog/ui/features/canvas/components/RenameChannelModal";
import {
  useChannelStars,
  useChannelStarToggle,
} from "@posthog/ui/features/canvas/hooks/useChannelStars";
import {
  type Channel,
  useChannelMutations,
  useChannels,
} from "@posthog/ui/features/canvas/hooks/useChannels";
import { useChannelTaskData } from "@posthog/ui/features/canvas/hooks/useChannelTaskData";
import {
  useChannelTaskMutations,
  useChannelTasks,
  usePrefetchChannelTasks,
} from "@posthog/ui/features/canvas/hooks/useChannelTasks";
import {
  useDashboardMutations,
  useDashboards,
  usePrefetchDashboards,
} from "@posthog/ui/features/canvas/hooks/useDashboards";
import { TaskIcon } from "@posthog/ui/features/sidebar/components/items/TaskIcon";
import { useTaskPrStatus } from "@posthog/ui/features/sidebar/useTaskPrStatus";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import { useWorkspace } from "@posthog/ui/features/workspace/useWorkspace";
import { toast } from "@posthog/ui/primitives/toast";
import { track } from "@posthog/ui/shell/analytics";
import { AlertDialog, Box, Flex, Text } from "@radix-ui/themes";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { hostClient } from "../hostClient";

// Cap how many tasks each channel shows by default; the rest hide behind a
// "View more" button so a busy channel doesn't dominate the sidebar.
const MAX_VISIBLE_TASKS_PER_CHANNEL = 5;

// A canvas's leading icon, chosen from its template so the tree reads at a
// glance: bar chart for dashboards, line chart for web-analytics, plain file for
// blank canvases.
function iconForTemplate(templateId: string): ReactNode {
  switch (templateId) {
    case "web-analytics":
      return <ChartLineIcon size={16} className="text-gray-9" />;
    case "blank":
      return <FileIcon size={16} className="text-gray-9" />;
    default:
      return <ChartBarIcon size={16} className="text-gray-9" />;
  }
}

// Short "x ago" stamp for an item's subtitle. Coarse on purpose — the sidebar
// just needs recency at a glance, not a precise duration.
function relativeTime(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < hr) return `${Math.max(1, Math.round(diff / min))}m ago`;
  if (diff < day) return `${Math.round(diff / hr)}h ago`;
  const days = Math.round(diff / day);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// Hover-revealed "..." menu on a channel header: rename or delete the channel.
// `open`/`onOpenChange` are lifted so the parent's button group can stay
// visible while the menu is open.
function ChannelMenu({
  channel,
  open,
  onOpenChange,
}: {
  channel: Channel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { deleteChannel, isDeleting } = useChannelMutations();
  const { isStarred, toggleStar, removeStar } = useChannelStarToggle(channel);

  const onDelete = async () => {
    try {
      // Unfile the channel's dashboards + filed tasks first. The folder delete
      // would also cascade, but doing it explicitly via the typed endpoints
      // surfaces failures clearly. Best-effort — a failed child shouldn't
      // block removing the channel.
      const [dashboards, channelTasks] = await Promise.all([
        hostClient().dashboards.list.query({ channelId: channel.id }),
        hostClient().channelTasks.list.query({ channelId: channel.id }),
      ]);
      await Promise.allSettled([
        ...dashboards.map((d) =>
          hostClient().dashboards.delete.mutate({ id: d.id }),
        ),
        ...channelTasks.map((t) =>
          hostClient().channelTasks.unfile.mutate({ id: t.id }),
        ),
      ]);

      await deleteChannel(channel.id);
      removeStar();
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "delete",
        surface: "sidebar",
        channel_id: channel.id,
        success: true,
      });
      // If we're inside the channel being deleted, fall back to the index.
      if (pathname.startsWith(`/website/${channel.id}`)) {
        void navigate({ to: "/website" });
      }
    } catch (error) {
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "delete",
        surface: "sidebar",
        channel_id: channel.id,
        success: false,
      });
      toast.error("Couldn't delete channel", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="icon-xs"
              aria-label={`Options for ${channel.name}`}
              className={cn(
                "group-hover:border-border",
                "transition-opacity",
                open ? "opacity-100" : "opacity-0 group-hover/chan:opacity-100",
              )}
            >
              <DotsThreeIcon size={14} weight="bold" />
            </Button>
          }
        />
        <DropdownMenuContent
          align="end"
          side="bottom"
          sideOffset={4}
          className="w-auto min-w-fit"
        >
          <DropdownMenuItem
            onClick={() => {
              track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
                action_type: isStarred ? "unstar" : "star",
                surface: "sidebar",
                channel_id: channel.id,
              });
              toggleStar();
            }}
          >
            <StarIcon size={14} weight={isStarred ? "fill" : "regular"} />
            {isStarred ? "Unstar channel" : "Star channel"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
                action_type: "edit_context_open",
                surface: "sidebar",
                channel_id: channel.id,
              });
              navigate({
                to: "/website/$channelId/context",
                params: { channelId: channel.id },
              });
            }}
          >
            <FileTextIcon size={14} />
            Edit CONTEXT.md
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setRenameOpen(true)}>
            <PencilSimpleIcon size={14} />
            Rename channel
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            disabled={isDeleting}
            onClick={() => void onDelete()}
          >
            <TrashIcon size={14} />
            Delete channel
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameChannelModal
        channel={channel}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
    </>
  );
}

// A two-line child row (title + muted subtitle). Height is auto so the subtitle
// never collides with the next row — the icon top-aligns with the title.
function ChildRow({
  icon,
  title,
  subtitle,
  active,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="default"
      size="default"
      data-selected={active || undefined}
      onClick={onClick}
      className="h-auto w-full items-start justify-start gap-2 px-2 py-1 text-left data-selected:bg-fill-selected data-selected:text-gray-12"
    >
      <span className="mt-px shrink-0">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-[13px] text-gray-12 leading-tight">
          {title}
        </span>
        {subtitle ? (
          <span className="truncate text-[10px] text-muted-foreground/80 leading-tight">
            {subtitle}
          </span>
        ) : null}
      </span>
    </Button>
  );
}

// A single saved canvas under a channel — navigates to its detail view, with a
// right-click menu to delete it.
function DashboardRow({
  channelId,
  dashboard,
  active,
}: {
  channelId: string;
  dashboard: DashboardSummary;
  active: boolean;
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { deleteDashboard, isDeleting } = useDashboardMutations();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const onDelete = async () => {
    try {
      await deleteDashboard(dashboard.id);
      track(ANALYTICS_EVENTS.DASHBOARD_ACTION, {
        action_type: "delete",
        surface: "sidebar",
        channel_id: channelId,
        dashboard_id: dashboard.id,
        kind: dashboard.kind,
        success: true,
      });
      // Deleting destroys the canvas, including any child routes under it, so
      // match the whole subtree (mirrors ChannelMenu.onDelete).
      if (
        pathname.startsWith(`/website/${channelId}/dashboards/${dashboard.id}`)
      ) {
        void navigate({
          to: "/website/$channelId",
          params: { channelId },
        });
      }
    } catch (error) {
      track(ANALYTICS_EVENTS.DASHBOARD_ACTION, {
        action_type: "delete",
        surface: "sidebar",
        channel_id: channelId,
        dashboard_id: dashboard.id,
        kind: dashboard.kind,
        success: false,
      });
      toast.error("Couldn't delete canvas", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <>
      <ContextMenu>
        <Tooltip>
          <ContextMenuTrigger
            render={
              <TooltipTrigger>
                <ChildRow
                  icon={iconForTemplate(dashboard.templateId)}
                  title={dashboard.name}
                  subtitle={`${relativeTime(dashboard.updatedAt)}`}
                  active={active}
                  onClick={() => {
                    track(ANALYTICS_EVENTS.DASHBOARD_ACTION, {
                      action_type: "open",
                      surface: "sidebar",
                      channel_id: channelId,
                      dashboard_id: dashboard.id,
                      kind: dashboard.kind,
                      template_id: dashboard.templateId,
                    });
                    navigate({
                      to: "/website/$channelId/dashboards/$dashboardId",
                      params: { channelId, dashboardId: dashboard.id },
                    });
                  }}
                />
              </TooltipTrigger>
            }
          />
          <TooltipContent side="right">{dashboard.name}</TooltipContent>
        </Tooltip>
        <ContextMenuContent>
          <ContextMenuItem
            variant="destructive"
            disabled={isDeleting}
            onClick={() => setConfirmOpen(true)}
          >
            <TrashIcon size={14} />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <AlertDialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialog.Content maxWidth="420px" size="2">
          <AlertDialog.Title size="3">Delete canvas</AlertDialog.Title>
          <AlertDialog.Description size="1">
            "{dashboard.name}" will be permanently deleted. This can't be
            undone.
          </AlertDialog.Description>
          <Flex justify="end" gap="2" mt="4">
            <AlertDialog.Cancel>
              <Button variant="outline" size="sm">
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                variant="destructive"
                size="sm"
                disabled={isDeleting}
                onClick={() => void onDelete()}
              >
                Delete
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}

// Right-click "File to..." submenu on a task row. Files the task to another
// channel by creating an extra `task` FS row under that folder.
function TaskRow({
  channelTaskId,
  channelId,
  taskId,
  task,
  title,
  active,
  onClick,
  channels,
}: {
  channelTaskId: string;
  channelId: string;
  taskId: string;
  task: Task | undefined;
  title: string;
  active: boolean;
  onClick: () => void;
  channels: Channel[];
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { fileTask, unfileTask } = useChannelTaskMutations();
  // Archiving from the bluebird/channels nav should return to the website
  // new-task screen, not the Code one.
  const { archiveTask } = useArchiveTask({ navigateSpace: "website" });
  const taskData = useChannelTaskData(task);
  const workspace = useWorkspace(taskId);
  const workspaceMode =
    workspace?.mode ??
    (taskData?.taskRunEnvironment === "cloud" ? "cloud" : undefined);
  const { prState, hasDiff } = useTaskPrStatus({
    id: taskId,
    cloudPrUrl: taskData?.cloudPrUrl ?? null,
    taskRunEnvironment: taskData?.taskRunEnvironment ?? null,
  });
  const icon = taskData ? (
    <TaskIcon
      workspaceMode={workspaceMode}
      isGenerating={taskData.isGenerating}
      isUnread={taskData.isUnread}
      isPinned={taskData.isPinned}
      isSuspended={taskData.isSuspended}
      needsPermission={taskData.needsPermission}
      taskRunStatus={taskData.taskRunStatus}
      originProduct={taskData.originProduct}
      slackThreadUrl={taskData.slackThreadUrl}
      prState={prState}
      hasDiff={hasDiff}
      size={16}
    />
  ) : (
    <CodeIcon size={16} className="text-gray-9" />
  );

  // A short status word under the title (running / merged / …), mirroring the
  // task's live state. Falls back to the run status when there's no PR yet.
  const status =
    taskData?.isGenerating === true
      ? "running"
      : (prState ?? taskData?.taskRunStatus ?? undefined);

  const onFileTo = async (targetChannelId: string) => {
    try {
      await fileTask(targetChannelId, taskId, title);
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "file_task",
        surface: "sidebar",
        channel_id: channelId,
        target_channel_id: targetChannelId,
        task_id: taskId,
        success: true,
      });
    } catch (error) {
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "file_task",
        surface: "sidebar",
        channel_id: channelId,
        target_channel_id: targetChannelId,
        task_id: taskId,
        success: false,
      });
      toast.error("Couldn't file task", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const onArchive = async () => {
    try {
      await archiveTask({ taskId });
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "archive_task",
        surface: "sidebar",
        channel_id: channelId,
        task_id: taskId,
        success: true,
      });
    } catch (error) {
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "archive_task",
        surface: "sidebar",
        channel_id: channelId,
        task_id: taskId,
        success: false,
      });
      toast.error("Couldn't archive task", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const onRemove = async () => {
    try {
      await unfileTask(channelTaskId);
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "unfile_task",
        surface: "sidebar",
        channel_id: channelId,
        task_id: taskId,
        success: true,
      });
      if (pathname === `/website/${channelId}/tasks/${taskId}`) {
        void navigate({
          to: "/website/$channelId",
          params: { channelId },
        });
      }
    } catch (error) {
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "unfile_task",
        surface: "sidebar",
        channel_id: channelId,
        task_id: taskId,
        success: false,
      });
      toast.error("Couldn't remove task from channel", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <ContextMenu>
      <Tooltip>
        <ContextMenuTrigger
          render={
            <TooltipTrigger>
              <ChildRow
                icon={icon}
                title={title}
                subtitle={status}
                active={active}
                onClick={onClick}
              />
            </TooltipTrigger>
          }
        />
        <TooltipContent side="right">{title}</TooltipContent>
      </Tooltip>
      <ContextMenuContent>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <FolderIcon size={14} />
            File to…
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {channels.filter((c) => c.id !== channelId).length === 0 ? (
              <ContextMenuItem disabled>No other channels</ContextMenuItem>
            ) : (
              channels
                .filter((c) => c.id !== channelId)
                .map((c) => (
                  <ContextMenuItem
                    key={c.id}
                    onClick={() => void onFileTo(c.id)}
                  >
                    {c.name}
                  </ContextMenuItem>
                ))
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => void onArchive()}>
          <ArchiveIcon size={14} />
          Archive
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onClick={() => void onRemove()}>
          <XIcon size={14} />
          Remove from channel
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// One channel in the tree: a "# name" header that expands to its canvases and
// filed tasks. Children only load once the channel is open.
function ChannelSection({
  channel,
  channels,
}: {
  channel: Channel;
  channels: Channel[];
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: tasks } = useTasks();
  const archivedTaskIds = useArchivedTaskIds();
  const base = `/website/${channel.id}`;
  const isActive = pathname === base || pathname.startsWith(`${base}/`);
  // The header surface navigates to the channel index, so only highlight it
  // when that exact route is open (children carry their own active state).
  const isIndexActive = pathname === base;
  // Expansion is owned by the left icon trigger only. A deep link / fresh load
  // into a channel opens it once (initial state), but navigating the main row
  // afterward just selects the channel — it does not expand it.
  const [open, setOpen] = useState(isActive);
  // Lifted so the hover button group stays visible while the menu is open.
  const [menuOpen, setMenuOpen] = useState(false);
  // The "New…" picker dialog, and the nested "Choose a template" dialog it
  // stacks on top when "New canvas" is chosen.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  // Only the first few tasks per channel show by default; "View more" reveals
  // another batch each click so a busy channel doesn't flood the sidebar.
  const [taskLimit, setTaskLimit] = useState(MAX_VISIBLE_TASKS_PER_CHANNEL);
  // Expansion is driven by the Collapsible's icon trigger; collapsing also
  // resets back to the first batch of tasks.
  const onOpenChange = (next: boolean) => {
    track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
      action_type: next ? "open_channel" : "collapse_channel",
      surface: "sidebar",
      channel_id: channel.id,
    });
    setOpen(next);
    if (!next) setTaskLimit(MAX_VISIBLE_TASKS_PER_CHANNEL);
  };

  // Lazy: a channel's canvases and filed tasks are only fetched once it's
  // expanded, so the tree doesn't fire one query per channel on mount.
  const { dashboards } = useDashboards(open ? channel.id : undefined);
  const { tasks: filedTasks } = useChannelTasks(open ? channel.id : undefined);
  // Warm both caches on hover/focus so the first expand is instant instead of
  // popping in after a cold fetch. No-ops once the data is fresh or loaded.
  const prefetchDashboards = usePrefetchDashboards();
  const prefetchChannelTasks = usePrefetchChannelTasks();
  const prefetchContents = () => {
    if (open) return;
    prefetchDashboards(channel.id);
    prefetchChannelTasks(channel.id);
  };
  // Tasks are private to each user. A task filed by someone else won't be in
  // `tasks` (it isn't shared with me), so hide it rather than rendering an
  // "Untitled task" placeholder. Also drop archived tasks.
  const visibleFiledTasks = filedTasks.filter(
    ({ taskId }) =>
      !archivedTaskIds.has(taskId) && tasks?.some((t) => t.id === taskId),
  );
  const displayedFiledTasks = visibleFiledTasks.slice(0, taskLimit);
  const hiddenTaskCount = visibleFiledTasks.length - displayedFiledTasks.length;
  // Reveal one more batch, capped at the remaining count.
  const nextBatchCount = Math.min(
    hiddenTaskCount,
    MAX_VISIBLE_TASKS_PER_CHANNEL,
  );

  return (
    <Box
      className="group/chan relative"
      onMouseEnter={prefetchContents}
      onFocus={prefetchContents}
    >
      <Collapsible variant="folder" open={open} onOpenChange={onOpenChange}>
        {/* Header row: the leading icon is the expand/collapse trigger (`#`
            swaps to a chevron on hover), and the rest of the row is a button
            that navigates into the channel index. */}
        <CollapsibleHeader>
          {/* Icon-only trigger — overlaid at the row's start edge. */}
          <CollapsibleTrigger
            iconOnly
            icon={<HashIcon size={14} />}
            aria-label={`Toggle ${channel.name}`}
          >
            Toggle {channel.name}
          </CollapsibleTrigger>
          {/* Full-row surface under the overlaid icon — ps-8 clears it so the
              name lines up with the "New" button above, and the whole row opens
              the channel index. */}
          <Button
            variant="default"
            size="default"
            left
            data-selected={isIndexActive || undefined}
            onClick={() => {
              track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
                action_type: "nav_click",
                surface: "sidebar",
                channel_id: channel.id,
              });
              navigate({
                to: "/website/$channelId",
                params: { channelId: channel.id },
              });
            }}
            className="w-full min-w-0 justify-start ps-8 data-selected:bg-fill-selected data-selected:text-gray-12"
          >
            <span
              className={cn(
                "truncate font-medium text-[13px] text-gray-12 group-hover/chan:pr-8",
                menuOpen && "pr-8",
              )}
            >
              {channel.name}
            </span>
          </Button>
        </CollapsibleHeader>
        {/* Hover actions: new task + the options menu. Stay visible while the
            menu is open. */}
        <div className="absolute top-1 right-1">
          <ButtonGroup>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon-xs"
                    aria-label={`New in ${channel.name}`}
                    onClick={() => setPickerOpen(true)}
                    className={cn(
                      "gap-1 transition-opacity group-hover:border-border",
                      menuOpen || pickerOpen
                        ? "opacity-100"
                        : "opacity-0 group-hover/chan:opacity-100",
                    )}
                  >
                    <PlusIcon size={12} weight="bold" />
                  </Button>
                }
              />
              <TooltipContent side="top">New…</TooltipContent>
            </Tooltip>
            <ChannelMenu
              channel={channel}
              open={menuOpen}
              onOpenChange={setMenuOpen}
            />
          </ButtonGroup>
        </div>
        {/* "New…" picker: choose task vs canvas. "New canvas" opens the
            template picker as a Base UI nested dialog, so it stacks on top and
            dismissing it returns here. */}
        <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Create new</DialogTitle>
              <DialogDescription>
                Add a task or a canvas to {channel.name}.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="gap-0">
              <Button
                variant="default"
                className="h-auto w-full flex-col items-start gap-0.5 whitespace-normal py-3 text-left"
                onClick={() => {
                  setPickerOpen(false);
                  track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
                    action_type: "new_task_open",
                    surface: "sidebar",
                    channel_id: channel.id,
                  });
                  navigate({
                    to: "/website/$channelId/new",
                    params: { channelId: channel.id },
                  });
                }}
              >
                <span className="font-medium text-gray-12">New task</span>
                <span className="font-normal text-gray-10 text-xs [text-wrap:initial]">
                  Describe something for the agent to work on in this channel.
                </span>
              </Button>
              <Dialog open={canvasOpen} onOpenChange={setCanvasOpen}>
                <DialogTrigger
                  render={(props) => (
                    <Button
                      variant="default"
                      className="h-auto w-full flex-col items-start gap-0.5 whitespace-normal py-3 text-left"
                      {...props}
                    />
                  )}
                >
                  <span className="font-medium text-gray-12">New canvas</span>
                  <span className="font-normal text-gray-10 text-xs [text-wrap:initial]">
                    Build a dashboard or freeform canvas from a template.
                  </span>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>Choose a template</DialogTitle>
                    <DialogDescription>
                      This gives the agent context for which guardrails to
                      follow when generating UI.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogBody className="flex flex-col gap-2">
                    <CanvasTemplateList
                      channelId={channel.id}
                      surface="sidebar"
                      onPicked={() => {
                        setCanvasOpen(false);
                        setPickerOpen(false);
                      }}
                    />
                  </DialogBody>
                </DialogContent>
              </Dialog>
            </DialogBody>
          </DialogContent>
        </Dialog>
        {/* Children hang off a vertical guide line, like a tree. The folder
            variant's own inset is removed so the guide line controls indent. */}
        <CollapsibleContent className="px-0">
          <Flex
            direction="column"
            gap="px"
            className="mt-px ml-[11px] border-gray-6 border-l pl-2 empty:hidden"
          >
            {dashboards.map((d) => (
              <DashboardRow
                key={d.id}
                channelId={channel.id}
                dashboard={d}
                active={pathname === `${base}/dashboards/${d.id}`}
              />
            ))}
            {displayedFiledTasks.map(({ id: channelTaskId, taskId }) => {
              const task = tasks?.find((t) => t.id === taskId);
              const title = task?.title || "Untitled task";
              return (
                <TaskRow
                  key={channelTaskId}
                  channelTaskId={channelTaskId}
                  channelId={channel.id}
                  taskId={taskId}
                  task={task}
                  title={title}
                  active={pathname === `${base}/tasks/${taskId}`}
                  onClick={() =>
                    navigate({
                      to: "/website/$channelId/tasks/$taskId",
                      params: { channelId: channel.id, taskId },
                    })
                  }
                  channels={channels}
                />
              );
            })}
            {hiddenTaskCount > 0 && (
              <Button
                variant="default"
                size="default"
                onClick={() => {
                  track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
                    action_type: "view_more_tasks",
                    surface: "sidebar",
                    channel_id: channel.id,
                  });
                  setTaskLimit((n) => n + MAX_VISIBLE_TASKS_PER_CHANNEL);
                }}
                className="w-full min-w-0 justify-start gap-2 text-[13px] text-gray-10"
              >
                <span className="inline-flex size-[14px] shrink-0 items-center justify-center">
                  <CaretDownIcon size={12} />
                </span>
                View {nextBatchCount} more
              </Button>
            )}
          </Flex>
        </CollapsibleContent>
      </Collapsible>
    </Box>
  );
}

// The channel list — the Channels space sidebar body. Starred channels surface
// in their own section at the top so the ones you use most stay in reach; the
// rest sit under a "Channels" label with the "New" channel button.
export function ChannelsList() {
  const { channels, isLoading } = useChannels();
  const { starredRefToShortcutId } = useChannelStars();
  const [modalOpen, setModalOpen] = useState(false);

  const starred = channels.filter((c) => starredRefToShortcutId.has(c.path));
  const others = channels.filter((c) => !starredRefToShortcutId.has(c.path));

  // Fire CHANNELS_SPACE_VIEWED once per space mount, after channels first load
  // (so the counts are accurate). The sidebar stays mounted while navigating
  // between channels, so this naturally fires once per entry into the space.
  const viewedTrackedRef = useRef(false);
  useEffect(() => {
    if (isLoading || viewedTrackedRef.current) return;
    viewedTrackedRef.current = true;
    track(ANALYTICS_EVENTS.CHANNELS_SPACE_VIEWED, {
      channel_count: channels.length,
      starred_count: starred.length,
    });
  }, [isLoading, channels.length, starred.length]);

  return (
    // One shared provider groups every row tooltip so that once one shows,
    // moving to the next row reveals its tooltip instantly (no re-delay).
    <TooltipProvider delay={600}>
      <Flex direction="column" gap="px" className="px-2 pb-2">
        <Box className="py-1.5">
          <Separator />
        </Box>

        {starred.length > 0 && (
          <>
            <Box>
              <MenuLabel className="flex items-center gap-2 uppercase">
                <StarIcon size={14} className="text-gray-9" />
                Starred
              </MenuLabel>
            </Box>
            <div className="pl-2">
              {starred.map((channel) => (
                <ChannelSection
                  key={channel.id}
                  channel={channel}
                  channels={channels}
                />
              ))}
            </div>
          </>
        )}

        <Box className={cn(starred.length > 0 && "mt-3")}>
          <MenuLabel className="group flex items-center justify-between uppercase">
            <span className="flex items-center gap-2">
              <HashIcon size={14} className="text-gray-9" />
              Channels
            </span>
            <Button
              variant="outline"
              size="icon-xs"
              onClick={() => setModalOpen(true)}
              className="-mr-1 group-hover:border-border"
            >
              <PlusIcon size={14} />
            </Button>
          </MenuLabel>
        </Box>

        {!isLoading && channels.length === 0 && (
          <Text size="1" className="px-2 text-gray-9">
            No channels yet. Create one to get started.
          </Text>
        )}

        <div className="pl-2">
          {others.map((channel) => (
            <ChannelSection
              key={channel.id}
              channel={channel}
              channels={channels}
            />
          ))}
        </div>
      </Flex>

      <CreateChannelModal open={modalOpen} onOpenChange={setModalOpen} />
    </TooltipProvider>
  );
}

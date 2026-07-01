import { ArrowRightIcon, CaretRightIcon } from "@phosphor-icons/react";
import type { DashboardSummary } from "@posthog/core/canvas/dashboardSchemas";
import {
  cn,
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarTrigger,
} from "@posthog/quill";
import { formatRelativeTimeShort } from "@posthog/shared";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import type { Task } from "@posthog/shared/domain-types";
import { useArchivedTaskIds } from "@posthog/ui/features/archive/useArchivedTaskIds";
import { TaskTabIcon } from "@posthog/ui/features/browser-tabs/TaskTabIcon";
import {
  CHANNEL_SUGGESTION_CATEGORIES,
  type SuggestionCategory,
} from "@posthog/ui/features/canvas/channelTaskSuggestions";
import { ChannelHeader } from "@posthog/ui/features/canvas/components/ChannelHeader";
import {
  ChannelHomeComposer,
  type ChannelHomeComposerHandle,
} from "@posthog/ui/features/canvas/components/ChannelHomeComposer";
import { iconForTemplate } from "@posthog/ui/features/canvas/components/canvasTemplateIcon";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import {
  useChannelTaskMutations,
  useChannelTasks,
} from "@posthog/ui/features/canvas/hooks/useChannelTasks";
import { useDashboards } from "@posthog/ui/features/canvas/hooks/useDashboards";
import { useFolderInstructions } from "@posthog/ui/features/canvas/hooks/useFolderInstructions";
import type { SuggestedPrompt } from "@posthog/ui/features/task-detail/components/SuggestedPromptCard";
import { taskDetailQuery } from "@posthog/ui/features/tasks/queries";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import { useSetHeaderContent } from "@posthog/ui/hooks/useSetHeaderContent";
import { toast } from "@posthog/ui/primitives/toast";
import { track } from "@posthog/ui/shell/analytics";
import { Flex, Text } from "@radix-ui/themes";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";

const RECENT_TASK_LIMIT = 5;
const PINNED_ARTIFACT_LIMIT = 5;

// A channel's homepage: a heading, the composer that files new tasks into the
// channel, the starter-prompt suggestions, and a two-column glance at the
// channel's recent tasks and pinned artifacts. The full lists live behind the
// "Recents" and "Artifacts" tabs.
export function WebsiteChannelHome({ channelId }: { channelId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { channels } = useChannels();
  const channelName = channels.find((c) => c.id === channelId)?.name;
  const { fileTask } = useChannelTaskMutations();

  const { data: instructions } = useFolderInstructions(channelId);
  const channelContext = instructions?.content;

  useSetHeaderContent(
    useMemo(() => <ChannelHeader channelId={channelId} />, [channelId]),
  );

  const composerRef = useRef<ChannelHomeComposerHandle>(null);
  // While the user is typing, dim the suggestions + lists so the focus stays on
  // the prompt box.
  const [composerEmpty, setComposerEmpty] = useState(true);

  // Anchor for the category menus: pointing each popup at the whole menu bar
  // (rather than its own trigger) makes Base UI's --anchor-width the bar width,
  // so the popup fills the bar.
  const menuBarRef = useRef<HTMLDivElement>(null);

  // Which category menu is open, if any. The menu bar stays put while a menu is
  // open, but the recents below fade out so the options have the floor.
  const [openCategoryId, setOpenCategoryId] = useState<string | null>(null);
  const handleCategoryOpenChange = useCallback(
    (category: SuggestionCategory, open: boolean) => {
      setOpenCategoryId((prev) =>
        open ? category.id : prev === category.id ? null : prev,
      );
      if (open) {
        track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
          action_type: "select_suggestion_category",
          surface: "channel_home",
          channel_id: channelId,
          category: category.id,
        });
      }
    },
    [channelId],
  );

  const applySuggestion = useCallback(
    (suggestion: SuggestedPrompt, categoryId: string) => {
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "new_task_suggestion",
        surface: "channel_home",
        channel_id: channelId,
        category: categoryId,
        suggestion_label: suggestion.label,
      });
      composerRef.current?.applySuggestion(suggestion.prompt, suggestion.mode);
    },
    [channelId],
  );

  const onTaskCreated = useCallback(
    (task: Task) => {
      queryClient.setQueryData(taskDetailQuery(task.id).queryKey, task);
      void fileTask(channelId, task.id, task.title)
        .then(() =>
          track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
            action_type: "file_task",
            surface: "channel_home",
            channel_id: channelId,
            task_id: task.id,
            success: true,
          }),
        )
        .catch((error: unknown) => {
          track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
            action_type: "file_task",
            surface: "channel_home",
            channel_id: channelId,
            task_id: task.id,
            success: false,
          });
          toast.error("Couldn't file task to channel", {
            description: error instanceof Error ? error.message : String(error),
          });
        });
      void navigate({
        to: "/website/$channelId/tasks/$taskId",
        params: { channelId, taskId: task.id },
      });
    },
    [channelId, fileTask, navigate, queryClient],
  );

  return (
    <div className="h-full overflow-y-auto bg-gray-1">
      <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col justify-center gap-6 px-4 py-10">
        <div className="text-center">
          <h1 className="font-semibold text-2xl text-gray-12 tracking-tight">
            What can I do for you today?
          </h1>
          <Text className="mt-2 block text-[13px] text-gray-10">
            Ask anything, kick off a task, or pick up where you left off.
          </Text>
        </div>

        <ChannelHomeComposer
          ref={composerRef}
          channelId={channelId}
          channelName={channelName}
          channelContext={channelContext}
          onEmptyChange={setComposerEmpty}
          onTaskCreated={onTaskCreated}
        />

        {/* Category menu bar + recent/pinned glance. Everything fades out while
            the user is typing so the prompt box has the floor. */}
        <div
          className={cn(
            "transition-opacity duration-200",
            !composerEmpty && "pointer-events-none opacity-0",
          )}
          aria-hidden={!composerEmpty}
          inert={!composerEmpty || undefined}
        >
          {/* The bar is the anchor for every category popup: anchoring to it
              (not the trigger) makes each popup fill the bar's width. */}
          <div ref={menuBarRef} className="mx-auto my-4 w-fit">
            <Menubar className="h-auto flex-wrap justify-center gap-2 border-0 bg-transparent p-0 shadow-none">
              {CHANNEL_SUGGESTION_CATEGORIES.map((category) => (
                <CategoryMenu
                  key={category.id}
                  category={category}
                  anchor={menuBarRef}
                  onOpenChange={(open) =>
                    handleCategoryOpenChange(category, open)
                  }
                  onSelect={(suggestion) =>
                    applySuggestion(suggestion, category.id)
                  }
                />
              ))}
            </Menubar>
          </div>

          {/* Recents fade out while a category menu is open. */}
          <div
            className={cn(
              "grid grid-cols-2 gap-6 transition-opacity duration-200",
              openCategoryId && "pointer-events-none opacity-0",
            )}
            aria-hidden={!!openCategoryId}
            inert={!!openCategoryId || undefined}
          >
            <RecentTasksColumn channelId={channelId} />
            <PinnedArtifactsColumn channelId={channelId} />
          </div>
        </div>
      </div>
    </div>
  );
}

// One category in the menu bar: a chip-styled trigger, and a popup listing the
// category's suggested actions. The popup is anchored to the whole bar so it
// fills the bar's width (via Base UI's --anchor-width).
function CategoryMenu({
  category,
  anchor,
  onOpenChange,
  onSelect,
}: {
  category: SuggestionCategory;
  anchor: React.RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
  onSelect: (suggestion: SuggestedPrompt) => void;
}) {
  const Icon = category.icon;
  return (
    <MenubarMenu onOpenChange={onOpenChange}>
      <MenubarTrigger
        className="inline-flex items-center gap-1.5 rounded-full border border-(--gray-a4) bg-(--color-panel-solid) px-3 py-1.5 font-medium text-[13px] text-gray-11 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,color] hover:border-(--chip-hover) hover:bg-(--color-panel-solid) hover:text-gray-12 aria-expanded:border-(--chip-hover) aria-expanded:bg-(--color-panel-solid) aria-expanded:text-gray-12"
        style={
          {
            "--chip-hover": `var(--${category.color}-7)`,
          } as React.CSSProperties
        }
      >
        <Icon size={14} weight="duotone" color={`var(--${category.color}-9)`} />
        {category.label}
      </MenubarTrigger>
      <MenubarContent
        anchor={anchor}
        align="start"
        alignOffset={0}
        sideOffset={8}
        className="flex flex-col gap-0.5 p-2"
      >
        {category.suggestions.map((suggestion) => (
          <SuggestionRow
            key={suggestion.label}
            suggestion={suggestion}
            onSelect={() => onSelect(suggestion)}
          />
        ))}
      </MenubarContent>
    </MenubarMenu>
  );
}

// A single suggested action row: icon badge, title, then the description as
// muted text alongside it. Selecting it drops the prompt into the composer.
function SuggestionRow({
  suggestion,
  onSelect,
}: {
  suggestion: SuggestedPrompt;
  onSelect: () => void;
}) {
  const Icon = suggestion.icon;
  return (
    <MenubarItem
      onClick={onSelect}
      className="min-h-0 items-center gap-2.5 rounded-lg px-2 py-1.5"
    >
      <Flex
        align="center"
        justify="center"
        className="size-6 shrink-0 rounded-md"
        style={{ backgroundColor: `var(--${suggestion.color}-3)` }}
      >
        <Icon
          size={14}
          weight="duotone"
          color={`var(--${suggestion.color}-9)`}
        />
      </Flex>
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="shrink-0 font-medium text-[13px] text-gray-12">
          {suggestion.label}
        </span>
        <span className="truncate text-[12px] text-gray-10">
          {suggestion.description}
        </span>
      </span>
    </MenubarItem>
  );
}

// Left column: the channel's most recently active tasks, with the shared task
// status icons. "All tasks" jumps to the Recents tab.
function RecentTasksColumn({ channelId }: { channelId: string }) {
  const navigate = useNavigate();
  const { tasks: filedTasks, isLoading: filedLoading } =
    useChannelTasks(channelId);
  const { data: tasks, isLoading: tasksLoading } = useTasks();
  const archivedTaskIds = useArchivedTaskIds();

  const recentTasks = useMemo(() => {
    const taskById = new Map(tasks?.map((t) => [t.id, t]) ?? []);
    return filedTasks
      .flatMap((f) => {
        const task = taskById.get(f.taskId);
        if (!task || archivedTaskIds.has(f.taskId)) return [];
        return [{ task, ts: Date.parse(task.updated_at) || 0 }];
      })
      .sort((a, b) => b.ts - a.ts)
      .slice(0, RECENT_TASK_LIMIT);
  }, [filedTasks, tasks, archivedTaskIds]);

  const openTask = useCallback(
    (taskId: string) => {
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "open_task",
        surface: "channel_home",
        channel_id: channelId,
        task_id: taskId,
      });
      void navigate({
        to: "/website/$channelId/tasks/$taskId",
        params: { channelId, taskId },
      });
    },
    [channelId, navigate],
  );

  return (
    <ColumnShell
      title="Recent tasks"
      action={
        <Link
          to="/website/$channelId/history"
          params={{ channelId }}
          className="flex items-center gap-1 text-[12px] text-gray-10 transition-colors hover:text-gray-12"
        >
          All tasks
          <ArrowRightIcon size={12} />
        </Link>
      }
      empty={
        !filedLoading && !tasksLoading && recentTasks.length === 0
          ? "No tasks yet"
          : undefined
      }
    >
      {recentTasks.map(({ task, ts }) => (
        <ListRow
          key={task.id}
          icon={<TaskTabIcon task={task} size={15} />}
          title={task.title || "Untitled task"}
          subtitle={formatRelativeTimeShort(ts)}
          onClick={() => openTask(task.id)}
        />
      ))}
    </ColumnShell>
  );
}

// Right column: the channel's pinned canvases, most recently pinned first. No
// dedicated page yet, so this is the only surface for them.
function PinnedArtifactsColumn({ channelId }: { channelId: string }) {
  const navigate = useNavigate();
  const { dashboards, isLoading } = useDashboards(channelId);

  const pinned = useMemo(
    () =>
      dashboards
        .filter((d: DashboardSummary) => d.pinnedAt != null)
        .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0))
        .slice(0, PINNED_ARTIFACT_LIMIT),
    [dashboards],
  );

  const openCanvas = useCallback(
    (dashboardId: string) => {
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "open_artifact",
        surface: "channel_home",
        channel_id: channelId,
        dashboard_id: dashboardId,
      });
      void navigate({
        to: "/website/$channelId/dashboards/$dashboardId",
        params: { channelId, dashboardId },
      });
    },
    [channelId, navigate],
  );

  return (
    <ColumnShell
      title="Pinned"
      empty={
        !isLoading && pinned.length === 0
          ? "No pinned artifacts yet"
          : undefined
      }
    >
      {pinned.map((d) => (
        <ListRow
          key={d.id}
          icon={iconForTemplate(d.templateId, {
            size: 15,
            className: "text-violet-9",
          })}
          title={d.name}
          subtitle={`Canvas · ${formatRelativeTimeShort(d.updatedAt)}`}
          onClick={() => openCanvas(d.id)}
        />
      ))}
    </ColumnShell>
  );
}

function ColumnShell({
  title,
  action,
  empty,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  empty?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <Text size="1" weight="medium" className="text-(--gray-11)">
          {title}
        </Text>
        {action}
      </div>
      {empty ? (
        <Text className="px-1 py-2 text-[12px] text-gray-9">{empty}</Text>
      ) : (
        <div className="flex flex-col gap-0.5">{children}</div>
      )}
    </div>
  );
}

function ListRow({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-gray-3"
    >
      <span className="flex size-5 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-[13px] text-gray-12 leading-tight">
          {title}
        </span>
        <span className="truncate text-[11px] text-gray-10 leading-tight">
          {subtitle}
        </span>
      </span>
      <CaretRightIcon
        size={13}
        className="shrink-0 text-gray-8 opacity-0 transition-opacity group-hover:opacity-100"
      />
    </button>
  );
}

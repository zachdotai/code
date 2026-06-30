import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CaretRightIcon,
} from "@phosphor-icons/react";
import type { DashboardSummary } from "@posthog/core/canvas/dashboardSchemas";
import { cn } from "@posthog/quill";
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

  // Which category chip is expanded into its action list. `displayedCategoryId`
  // lags `activeCategoryId` so the detail box keeps its contents through the
  // fade-out when collapsing back to the chips.
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [displayedCategoryId, setDisplayedCategoryId] = useState<string | null>(
    null,
  );
  useEffect(() => {
    if (activeCategoryId) {
      setDisplayedCategoryId(activeCategoryId);
      return;
    }
    const id = setTimeout(() => setDisplayedCategoryId(null), 200);
    return () => clearTimeout(id);
  }, [activeCategoryId]);
  const displayedCategory = CHANNEL_SUGGESTION_CATEGORIES.find(
    (c) => c.id === displayedCategoryId,
  );

  const selectCategory = useCallback(
    (category: SuggestionCategory) => {
      setActiveCategoryId(category.id);
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "select_suggestion_category",
        surface: "channel_home",
        channel_id: channelId,
        category: category.id,
      });
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

        {/* Suggestions + recent/pinned glance. All fade out together while the
            user is typing so the prompt box has the floor. */}
        <div
          className={cn(
            "transition-opacity duration-200",
            !composerEmpty && "pointer-events-none opacity-0",
          )}
          aria-hidden={!composerEmpty}
          inert={!composerEmpty || undefined}
        >
          {/* The chips + recents and the expanded category box share this
              space and crossfade: the chips view stays in flow (holding the
              height) while the detail box overlays it. */}
          <div className="relative">
            <div
              className={cn(
                "flex flex-col gap-6 transition-opacity duration-200",
                activeCategoryId && "pointer-events-none opacity-0",
              )}
              aria-hidden={!!activeCategoryId}
              inert={!!activeCategoryId || undefined}
            >
              <div className="flex flex-wrap items-center justify-center gap-2">
                {CHANNEL_SUGGESTION_CATEGORIES.map((category) => (
                  <CategoryChip
                    key={category.id}
                    category={category}
                    onClick={() => selectCategory(category)}
                  />
                ))}
              </div>

              <div className="grid grid-cols-2 gap-6">
                <RecentTasksColumn channelId={channelId} />
                <PinnedArtifactsColumn channelId={channelId} />
              </div>
            </div>

            <div
              className={cn(
                "absolute inset-0 transition-opacity duration-200",
                activeCategoryId
                  ? "opacity-100"
                  : "pointer-events-none opacity-0",
              )}
              aria-hidden={!activeCategoryId}
              inert={!activeCategoryId || undefined}
            >
              {displayedCategory ? (
                <CategorySuggestions
                  category={displayedCategory}
                  onBack={() => setActiveCategoryId(null)}
                  onSelect={(suggestion) =>
                    applySuggestion(suggestion, displayedCategory.id)
                  }
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// A category pill below the prompt box. Clicking it expands the category's
// action list in place of the chips + recents.
function CategoryChip({
  category,
  onClick,
}: {
  category: SuggestionCategory;
  onClick: () => void;
}) {
  const Icon = category.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group inline-flex items-center gap-1.5 rounded-full border border-(--gray-a4) bg-(--color-panel-solid) px-3 py-1.5 font-medium text-[13px] text-gray-11 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,color] hover:border-(--chip-hover) hover:text-gray-12"
      style={
        { "--chip-hover": `var(--${category.color}-7)` } as React.CSSProperties
      }
    >
      <Icon size={14} weight="duotone" color={`var(--${category.color}-9)`} />
      {category.label}
    </button>
  );
}

// The expanded list for a category: a back button to collapse to the chips,
// then one row per suggested action.
function CategorySuggestions({
  category,
  onBack,
  onSelect,
}: {
  category: SuggestionCategory;
  onBack: () => void;
  onSelect: (suggestion: SuggestedPrompt) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-(--gray-a3) bg-(--color-panel-solid) p-2 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
      <div className="mb-1 flex items-center gap-1.5 px-1">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to categories"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-gray-10 transition-colors hover:bg-gray-3 hover:text-gray-12"
        >
          <ArrowLeftIcon size={14} />
        </button>
        <Text size="1" weight="medium" className="text-(--gray-11)">
          {category.label}
        </Text>
      </div>
      {category.suggestions.map((suggestion) => (
        <SuggestionRow
          key={suggestion.label}
          suggestion={suggestion}
          onSelect={() => onSelect(suggestion)}
        />
      ))}
    </div>
  );
}

// A single suggested action: icon badge, title, then the description as muted
// text alongside it.
function SuggestionRow({
  suggestion,
  onSelect,
}: {
  suggestion: SuggestedPrompt;
  onSelect: () => void;
}) {
  const Icon = suggestion.icon;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-gray-3"
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
    </button>
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

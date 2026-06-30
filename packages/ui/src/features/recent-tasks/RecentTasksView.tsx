import { GitPullRequestIcon, SquaresFourIcon } from "@phosphor-icons/react";
import type { Task, WorkspaceMode } from "@posthog/shared";
import { formatRelativeTimeLong } from "@posthog/shared";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { useArchivedTaskIds } from "@posthog/ui/features/archive/useArchivedTaskIds";
import type { Channel } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useTaskChannelMap } from "@posthog/ui/features/canvas/hooks/useTaskChannelMap";
import {
  type CanvasArtifact,
  useTaskCanvasArtifacts,
} from "@posthog/ui/features/recent-tasks/useTaskCanvasArtifacts";
import { TaskIcon } from "@posthog/ui/features/sidebar/components/items/TaskIcon";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import { NestedButton } from "@posthog/ui/primitives/NestedButton";
import { Tooltip } from "@posthog/ui/primitives/Tooltip";
import {
  navigateToChannelDashboard,
  navigateToChannelTask,
  navigateToTaskDetail,
} from "@posthog/ui/router/navigationBridge";
import { track } from "@posthog/ui/shell/analytics";
import { openExternalUrl } from "@posthog/ui/shell/openExternal";
import { Text } from "@radix-ui/themes";
import { useEffect, useMemo } from "react";

type RecentTaskRow = {
  task: Task;
  channel: Channel | undefined;
  // null when `updated_at` can't be parsed — the row then omits the time
  // rather than showing a misleading epoch (1970) date.
  updatedAt: number | null;
  canvases: CanvasArtifact[];
  prUrl: string | undefined;
};

// A cross-channel list of every task, most recent first. Each row shows the
// task's channel, its last-updated time, and the same status icon the sidebar
// and command palette render. Reached from the Channels-space nav ("Recent
// tasks", below "Files").
export function RecentTasksView() {
  const { data: tasks, isLoading } = useTasks();
  const { channels } = useChannels();
  const taskChannelMap = useTaskChannelMap(channels);
  const canvasArtifacts = useTaskCanvasArtifacts(channels);
  const archivedTaskIds = useArchivedTaskIds();

  useEffect(() => {
    track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
      action_type: "view_recent_tasks",
      surface: "recent_tasks",
    });
  }, []);

  const rows = useMemo<RecentTaskRow[]>(() => {
    // Filter + map in a single pass, then sort most-recent-first. A null
    // `updatedAt` (unparseable date) sorts last.
    const result: RecentTaskRow[] = [];
    for (const task of tasks ?? []) {
      if (archivedTaskIds.has(task.id)) continue;
      const parsed = Date.parse(task.updated_at);
      const prUrl = task.latest_run?.output?.pr_url;
      result.push({
        task,
        channel: taskChannelMap.get(task.id),
        updatedAt: Number.isNaN(parsed) ? null : parsed,
        canvases: canvasArtifacts.get(task.id) ?? [],
        prUrl: typeof prUrl === "string" ? prUrl : undefined,
      });
    }
    return result.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }, [tasks, taskChannelMap, canvasArtifacts, archivedTaskIds]);

  return (
    <div className="h-full overflow-y-auto bg-gray-1">
      <div className="mx-auto w-full max-w-[680px] px-4 py-6">
        <Text className="mb-3 block font-semibold text-[15px] text-gray-12">
          Recent tasks
        </Text>
        {rows.length === 0 ? (
          // Only the loaded-but-empty state shows the message; while the task
          // list is still in flight the area stays blank so "No tasks yet"
          // doesn't flash on every mount.
          isLoading ? null : (
            <div className="flex flex-col items-center gap-1 py-24 text-center">
              <Text className="font-medium text-[14px] text-gray-12">
                No tasks yet
              </Text>
              <Text className="text-[13px] text-gray-10">
                Tasks you create show up here, most recent first.
              </Text>
            </div>
          )
        ) : (
          <div className="flex flex-col gap-0.5">
            {rows.map((row) => (
              <RecentTaskItemRow key={row.task.id} row={row} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RecentTaskItemRow({ row }: { row: RecentTaskRow }) {
  const { task, channel, updatedAt, canvases, prUrl } = row;

  // The status icon is derived straight from the task's latest_run, rather than
  // the sidebar's richer per-task session/workspace state, which isn't loaded
  // for this cross-channel list.
  const latestRun = task.latest_run;
  const workspaceMode: WorkspaceMode | undefined =
    latestRun?.environment === "cloud" ? "cloud" : undefined;
  const slackThreadUrl =
    typeof latestRun?.state?.slack_thread_url === "string"
      ? latestRun.state.slack_thread_url
      : undefined;

  const onClick = () => {
    if (channel) {
      navigateToChannelTask(channel.id, task.id);
    } else {
      navigateToTaskDetail(task.id);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-gray-3"
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-gray-3">
        <TaskIcon
          workspaceMode={workspaceMode}
          taskRunStatus={latestRun?.status}
          originProduct={task.origin_product}
          slackThreadUrl={slackThreadUrl}
          size={15}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-[13px] text-gray-12 leading-tight">
          {task.title || "Untitled task"}
        </span>
        <span className="truncate text-[11px] text-gray-10 leading-tight">
          {channel ? `#${channel.name}` : "No channel"}
          {updatedAt !== null ? ` · ${formatRelativeTimeLong(updatedAt)}` : ""}
        </span>
      </span>
      <TaskArtifacts canvases={canvases} prUrl={prUrl} />
    </button>
  );
}

// Small clickable icons for the artifacts a task produced — canvases it
// generated and the pull request it opened. Each opens its artifact; they sit
// to the right of the row, opposite the metadata. NestedButton keeps these
// interactive without nesting a <button> inside the row's <button>.
function TaskArtifacts({
  canvases,
  prUrl,
}: {
  canvases: CanvasArtifact[];
  prUrl: string | undefined;
}) {
  if (canvases.length === 0 && !prUrl) return null;

  return (
    <span className="flex shrink-0 items-center gap-1">
      {canvases.map((canvas) => (
        <Tooltip key={canvas.id} content={`Open canvas: ${canvas.name}`}>
          <NestedButton
            aria-label={`Open canvas: ${canvas.name}`}
            className="flex size-6 cursor-pointer items-center justify-center rounded text-gray-10 transition-colors hover:bg-gray-4 hover:text-gray-12"
            onActivate={() =>
              navigateToChannelDashboard(canvas.channelId, canvas.id)
            }
          >
            <SquaresFourIcon size={14} />
          </NestedButton>
        </Tooltip>
      ))}
      {prUrl && (
        <Tooltip content="Open pull request">
          <NestedButton
            aria-label="Open pull request"
            className="flex size-6 cursor-pointer items-center justify-center rounded text-gray-10 transition-colors hover:bg-gray-4 hover:text-gray-12"
            onActivate={() => openExternalUrl(prUrl)}
          >
            <GitPullRequestIcon size={14} />
          </NestedButton>
        </Tooltip>
      )}
    </span>
  );
}

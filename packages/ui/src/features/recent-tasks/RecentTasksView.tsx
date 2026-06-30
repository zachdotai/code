import type { Task, WorkspaceMode } from "@posthog/shared";
import { formatRelativeTimeLong } from "@posthog/shared";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { useArchivedTaskIds } from "@posthog/ui/features/archive/useArchivedTaskIds";
import type { Channel } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useTaskChannelMap } from "@posthog/ui/features/canvas/hooks/useTaskChannelMap";
import { TaskIcon } from "@posthog/ui/features/sidebar/components/items/TaskIcon";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import {
  navigateToChannelTask,
  navigateToTaskDetail,
} from "@posthog/ui/router/navigationBridge";
import { track } from "@posthog/ui/shell/analytics";
import { Text } from "@radix-ui/themes";
import { useEffect, useMemo } from "react";

type RecentTaskRow = {
  task: Task;
  channel: Channel | undefined;
  updatedAt: number;
};

// A cross-channel list of every task, most recent first. Each row shows the
// task's channel, its last-updated time, and the same status icon the sidebar
// and command palette render. Reached from the Channels-space nav ("Recent
// tasks", below "Files").
export function RecentTasksView() {
  const { data: tasks } = useTasks();
  const { channels } = useChannels();
  const taskChannelMap = useTaskChannelMap(channels);
  const archivedTaskIds = useArchivedTaskIds();

  useEffect(() => {
    track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
      action_type: "view_recent_tasks",
      surface: "recent_tasks",
    });
  }, []);

  const rows = useMemo<RecentTaskRow[]>(() => {
    return (tasks ?? [])
      .filter((task) => !archivedTaskIds.has(task.id))
      .map((task) => ({
        task,
        channel: taskChannelMap.get(task.id),
        updatedAt: Date.parse(task.updated_at) || 0,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [tasks, taskChannelMap, archivedTaskIds]);

  return (
    <div className="h-full overflow-y-auto bg-gray-1">
      <div className="mx-auto w-full max-w-[680px] px-4 py-6">
        <Text className="mb-3 block font-semibold text-[15px] text-gray-12">
          Recent tasks
        </Text>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-1 py-24 text-center">
            <Text className="font-medium text-[14px] text-gray-12">
              No tasks yet
            </Text>
            <Text className="text-[13px] text-gray-10">
              Tasks you create show up here, most recent first.
            </Text>
          </div>
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
  const { task, channel, updatedAt } = row;

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
          {channel ? channel.name : "No channel"} ·{" "}
          {formatRelativeTimeLong(updatedAt)}
        </span>
      </span>
    </button>
  );
}

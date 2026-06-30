import {
  CaretRightIcon,
  ClockCounterClockwiseIcon,
} from "@phosphor-icons/react";
import { formatRelativeTimeLong } from "@posthog/shared";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import type { Task } from "@posthog/shared/domain-types";
import { useArchivedTaskIds } from "@posthog/ui/features/archive/useArchivedTaskIds";
import {
  type Channel,
  useChannels,
} from "@posthog/ui/features/canvas/hooks/useChannels";
import { useTaskChannelMap } from "@posthog/ui/features/canvas/hooks/useTaskChannelMap";
import { TaskIcon } from "@posthog/ui/features/sidebar/components/items/TaskIcon";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import { useSetHeaderContent } from "@posthog/ui/hooks/useSetHeaderContent";
import {
  navigateToChannelTask,
  navigateToTaskDetail,
} from "@posthog/ui/router/navigationBridge";
import { track } from "@posthog/ui/shell/analytics";
import { Flex, Text } from "@radix-ui/themes";
import { useEffect, useMemo } from "react";

// The cloud run status on `latest_run` is the authoritative running/done signal
// for channel work (tasks run in the cloud), so the same TaskIcon the sidebar
// uses renders identically here. Live-session signals (unread, a generating
// local session) aren't resolved in this cross-channel overview.
function taskIconProps(task: Task) {
  const slackThreadUrl = task.latest_run?.state?.slack_thread_url;
  return {
    workspaceMode:
      task.latest_run?.environment === "cloud"
        ? ("cloud" as const)
        : ("local" as const),
    taskRunStatus: task.latest_run?.status,
    originProduct: task.origin_product,
    slackThreadUrl:
      typeof slackThreadUrl === "string" ? slackThreadUrl : undefined,
  };
}

// All of the user's tasks across every channel, most-recently-updated first.
// Reached from the "Recent tasks" item in the Channels nav.
export function RecentTasksView() {
  useEffect(() => {
    track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
      action_type: "view_recent_tasks",
      surface: "recent_tasks",
    });
  }, []);

  useSetHeaderContent(
    useMemo(
      () => (
        <Flex align="center" gap="2" className="w-full min-w-0">
          <ClockCounterClockwiseIcon
            size={12}
            className="shrink-0 text-gray-10"
          />
          <Text
            className="truncate whitespace-nowrap font-medium text-[13px]"
            title="Recent tasks"
          >
            Recent tasks
          </Text>
        </Flex>
      ),
      [],
    ),
  );

  const { data: tasks, isLoading } = useTasks();
  const archivedTaskIds = useArchivedTaskIds();
  const { channels } = useChannels();
  const taskChannelMap = useTaskChannelMap(channels);

  const sortedTasks = useMemo(
    () =>
      (tasks ?? [])
        .filter((task) => !archivedTaskIds.has(task.id))
        .sort(
          (a, b) =>
            (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0),
        ),
    [tasks, archivedTaskIds],
  );

  return (
    <div className="h-full overflow-y-auto bg-gray-1">
      <div className="mx-auto w-full max-w-[680px] px-4 py-6">
        {sortedTasks.length === 0 ? (
          <div className="flex flex-col items-center gap-1 py-24 text-center">
            <Text className="font-medium text-[14px] text-gray-12">
              {isLoading ? "Loading tasks…" : "No tasks yet"}
            </Text>
            {!isLoading && (
              <Text className="text-[13px] text-gray-10">
                Tasks you create show up here, most recent first.
              </Text>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {sortedTasks.map((task) => (
              <RecentTaskRow
                key={task.id}
                task={task}
                channel={taskChannelMap.get(task.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RecentTaskRow({
  task,
  channel,
}: {
  task: Task;
  channel: Channel | undefined;
}) {
  const onClick = () => {
    track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
      action_type: "open_task",
      surface: "recent_tasks",
      task_id: task.id,
      channel_id: channel?.id,
    });
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
        <TaskIcon size={15} {...taskIconProps(task)} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-[13px] text-gray-12 leading-tight">
          {task.title || "Untitled task"}
        </span>
        <span className="truncate text-[11px] text-gray-10 leading-tight">
          {channel?.name ?? "No channel"} ·{" "}
          {formatRelativeTimeLong(task.updated_at)}
        </span>
      </span>
      <CaretRightIcon
        size={14}
        className="shrink-0 text-gray-8 opacity-0 transition-opacity group-hover:opacity-100"
      />
    </button>
  );
}

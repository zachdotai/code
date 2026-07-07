import type { Task } from "@posthog/shared/domain-types";
import { ThreadSidebar } from "@posthog/ui/features/canvas/components/ThreadSidebar";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useThreadPanelStore } from "@posthog/ui/features/canvas/stores/threadPanelStore";
import { useTaskViewed } from "@posthog/ui/features/sidebar/useTaskViewed";
import { TaskDetail } from "@posthog/ui/features/task-detail/components/TaskDetail";
import {
  getCachedTask,
  getCachedTaskDetail,
  isTaskDetailNotFoundError,
  taskDetailQuery,
} from "@posthog/ui/features/tasks/queries";
import { pickFreshestTask } from "@posthog/ui/features/tasks/taskFreshness";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import { RoutePending } from "@posthog/ui/router/RoutePending";
import { Button, Flex, Text } from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/website/$channelId/tasks/$taskId")({
  component: ChannelTaskDetailRoute,
  // Cache-only loader (same as /code/tasks/$taskId): never block navigation on
  // the network; the cold-miss fetch lives in the component.
  loader: ({ params }): Task | null =>
    getCachedTaskDetail(params.taskId) ?? getCachedTask(params.taskId) ?? null,
});

function ChannelTaskDetailRoute() {
  const { channelId, taskId } = Route.useParams();
  const loaderTask = Route.useLoaderData();
  const { data: tasks } = useTasks();
  const fromList = tasks?.find((t) => t.id === taskId);
  const initialTask = pickFreshestTask(fromList, loaderTask);
  const { channels } = useChannels();
  const channelName = channels.find((c) => c.id === channelId)?.name;

  // The channels space doesn't mount SidebarMenu (which marks code-space tasks
  // viewed on open), so mark it viewed here. Clears the task's unread state and
  // lets a canvas's generation task drop out of the nested sidebar row once the
  // user has actually looked at it.
  const { markAsViewed } = useTaskViewed();
  useEffect(() => {
    markAsViewed(taskId);
  }, [taskId, markAsViewed]);

  // Opening a task shows its thread docked on the right (collapsible). The
  // panel follows the task being viewed.
  const openThread = useThreadPanelStore((s) => s.openThread);
  useEffect(() => {
    openThread(taskId);
  }, [openThread, taskId]);

  const {
    data: fetched,
    error,
    isError,
    isFetching,
    isSuccess,
    refetch,
  } = useQuery({
    ...taskDetailQuery(taskId),
  });

  const task = pickFreshestTask(fetched, initialTask);

  if (isTaskDetailNotFoundError(error)) {
    return <Navigate replace to="/website/$channelId" params={{ channelId }} />;
  }

  if (!task && isSuccess && !fetched) {
    return <Navigate replace to="/website/$channelId" params={{ channelId }} />;
  }

  if (!task && isError) {
    const message =
      error instanceof Error ? error.message : "Failed to load task";
    return (
      <Flex align="center" justify="center" height="100%" width="100%">
        <Flex direction="column" align="center" gap="3">
          <Text weight="medium">Failed to load task</Text>
          <Text color="gray" size="2">
            {message}
          </Text>
          <Button
            variant="soft"
            size="2"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            Try again
          </Button>
        </Flex>
      </Flex>
    );
  }

  if (!task) {
    return <RoutePending />;
  }

  return (
    <div className="flex h-full min-w-0">
      <div className="min-w-0 flex-1">
        <TaskDetail
          key={task.id}
          task={task}
          channelName={channelName ?? "Channel"}
          channelId={channelId}
        />
      </div>
      <ThreadSidebar taskId={taskId} task={task} />
    </div>
  );
}

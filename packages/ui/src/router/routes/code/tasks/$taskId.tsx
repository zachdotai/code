import type { Task } from "@posthog/shared/domain-types";
import { TaskDetail } from "@posthog/ui/features/task-detail/components/TaskDetail";
import {
  getCachedTask,
  getCachedTaskDetail,
  taskDetailQuery,
} from "@posthog/ui/features/tasks/queries";
import { pickFreshestTask } from "@posthog/ui/features/tasks/taskFreshness";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import { RoutePending } from "@posthog/ui/router/RoutePending";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/code/tasks/$taskId")({
  component: TaskDetailRoute,
  // Synchronous + cache-only: return whatever is already cached (the detail
  // entry seeded by openTask, or the sidebar list) and never await the network.
  // A blocking loader would leave the route pending — and thus un-navigable —
  // whenever the fetch is slow or never resolves (optimistic/cloud-pending
  // tasks the API can't return). The cold-miss fetch + spinner live in the
  // component instead, so navigation always commits instantly.
  loader: ({ params }): Task | null =>
    getCachedTaskDetail(params.taskId) ?? getCachedTask(params.taskId) ?? null,
});

function TaskDetailRoute() {
  const { taskId } = Route.useParams();
  const loaderTask = Route.useLoaderData();
  const { data: tasks } = useTasks();
  const fromList = tasks?.find((t) => t.id === taskId);
  const initialTask = pickFreshestTask(fromList, loaderTask);

  // Always fetch so a stale cached copy converges on the server's latest run
  // state; render whichever copy is freshest.
  const {
    data: fetched,
    isError,
    isSuccess,
  } = useQuery(taskDetailQuery(taskId));

  const task = pickFreshestTask(fetched, initialTask);

  // Cold deep-link / URL restore with nothing cached: if the fetch settled
  // with an error or empty result, redirect to the new-task screen rather
  // than spin forever — matches the old navigationStore.hydrateTask. While a
  // cached/list copy exists, a 404 is NOT authoritative (optimistic and
  // cloud-pending tasks aren't returnable by the API yet — see the loader
  // comment), so never redirect away from a usable task.
  const needsFetch = !initialTask;
  if (needsFetch && (isError || (isSuccess && !fetched))) {
    return <Navigate replace to="/code" />;
  }

  if (!task) {
    return <RoutePending />;
  }

  return <TaskDetail key={task.id} task={task} />;
}

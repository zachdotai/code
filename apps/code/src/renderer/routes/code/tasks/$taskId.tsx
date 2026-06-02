import { TaskDetail } from "@features/task-detail/components/TaskDetail";
import { useTasks } from "@features/tasks/hooks/useTasks";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/code/tasks/$taskId")({
  component: TaskDetailRoute,
});

function TaskDetailRoute() {
  const { taskId } = Route.useParams();
  const { data: tasks } = useTasks();
  const task = tasks?.find((t) => t.id === taskId);

  if (!task) {
    return null;
  }

  return <TaskDetail key={task.id} task={task} />;
}

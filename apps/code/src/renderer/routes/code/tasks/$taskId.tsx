import { TaskDetail } from "@features/task-detail/components/TaskDetail";
import { useTasks } from "@features/tasks/hooks/useTasks";
import { useNavigationStore } from "@stores/navigationStore";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/code/tasks/$taskId")({
  component: TaskDetailRoute,
});

function TaskDetailRoute() {
  const { taskId } = Route.useParams();
  const { data: tasks } = useTasks();
  const taskFromList = tasks?.find((t) => t.id === taskId);

  // Silent sync of nav store to URL. Reads/writes via getState/setState so we
  // don't trigger the store's navigate() helper, which would call
  // router.navigate and fight with whatever navigation just landed us here.
  useEffect(() => {
    if (!taskFromList) return;
    const state = useNavigationStore.getState();
    if (
      state.view.type === "task-detail" &&
      state.view.data?.id === taskFromList.id
    ) {
      return;
    }
    useNavigationStore.setState({
      view: {
        type: "task-detail",
        data: taskFromList,
        taskId: taskFromList.id,
      },
    });
  }, [taskFromList]);

  const task = taskFromList;
  if (!task) {
    return null;
  }

  return <TaskDetail key={task.id} task={task} />;
}

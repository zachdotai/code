import { TaskDetail } from "@features/task-detail/components/TaskDetail";
import { useTasks } from "@features/tasks/hooks/useTasks";
import { Flex, Text } from "@radix-ui/themes";
import { useNavigationStore } from "@stores/navigationStore";

export function WorkTaskDetailView() {
  const taskId = useNavigationStore((s) => s.workActiveTaskId);
  const { data: tasks } = useTasks();

  const task = taskId ? tasks?.find((t) => t.id === taskId) : undefined;

  if (!taskId) {
    return null;
  }

  if (!task) {
    return (
      <Flex align="center" justify="center" className="h-full w-full">
        <Text className="text-(--gray-10) text-[13px]">Loading task...</Text>
      </Flex>
    );
  }

  return <TaskDetail key={task.id} task={task} />;
}

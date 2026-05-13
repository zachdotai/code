import { Text } from "@components/text";
import { differenceInHours, format, formatDistanceToNow } from "date-fns";
import { memo } from "react";
import { Pressable, View } from "react-native";
import type { Task } from "../types";
import { TaskStatusIcon } from "./TaskStatusIcon";

interface TaskItemProps {
  task: Task;
  onPress: (task: Task) => void;
}

function TaskItemComponent({ task, onPress }: TaskItemProps) {
  const createdAt = new Date(task.created_at);
  const hoursSinceCreated = differenceInHours(new Date(), createdAt);
  const timeDisplay =
    hoursSinceCreated < 24
      ? formatDistanceToNow(createdAt, { addSuffix: true })
      : format(createdAt, "MMM d");

  const environment = task.latest_run?.environment;

  return (
    <Pressable
      onPress={() => onPress(task)}
      className="flex-row items-start gap-3 border-gray-6 border-b px-3 py-3 active:bg-gray-3"
    >
      {/* Status icon column */}
      <View className="mt-0.5 h-5 w-5 shrink-0 items-center justify-center">
        <TaskStatusIcon task={task} size={16} />
      </View>

      {/* Content column */}
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-2">
          <Text className="shrink-0 text-[11px] text-gray-9">{task.slug}</Text>
          {environment === "cloud" && (
            <View className="rounded bg-accent-3 px-1.5 py-0.5">
              <Text className="text-[10px] text-accent-11">Cloud</Text>
            </View>
          )}
          {environment === "local" && (
            <View className="rounded bg-gray-4 px-1.5 py-0.5">
              <Text className="text-[10px] text-gray-11">Local</Text>
            </View>
          )}
          <View className="flex-1" />
          <Text className="shrink-0 text-[11px] text-gray-9">
            {timeDisplay}
          </Text>
        </View>

        <Text
          className="mt-1 font-medium text-[14px] text-gray-12"
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {task.title}
        </Text>

        {task.description ? (
          <Text
            className="mt-0.5 text-[12px] text-gray-10"
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {task.description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export const TaskItem = memo(TaskItemComponent);

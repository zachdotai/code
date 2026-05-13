import {
  CheckCircle,
  CircleIcon,
  CircleNotch,
  GitPullRequest,
  XCircle,
} from "phosphor-react-native";
import { memo, useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import { useThemeColors } from "@/lib/theme";
import type { Task } from "../types";

interface TaskStatusIconProps {
  task: Task;
  size?: number;
}

function TaskStatusIconComponent({ task, size = 16 }: TaskStatusIconProps) {
  const colors = useThemeColors();
  const prUrl = task.latest_run?.output?.pr_url as string | undefined;
  const status = task.latest_run?.status;

  const rotation = useRef(new Animated.Value(0)).current;
  const isRunning = !prUrl && status === "in_progress";

  useEffect(() => {
    if (!isRunning) {
      rotation.stopAnimation();
      rotation.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [isRunning, rotation]);

  // Priority: PR open > completed > failed > running > started > backlog
  if (prUrl) {
    return (
      <GitPullRequest size={size} weight="bold" color={colors.status.success} />
    );
  }

  if (status === "completed") {
    return (
      <CheckCircle size={size} weight="fill" color={colors.status.success} />
    );
  }

  if (status === "failed") {
    return <XCircle size={size} weight="fill" color={colors.status.error} />;
  }

  if (status === "in_progress") {
    const spin = rotation.interpolate({
      inputRange: [0, 1],
      outputRange: ["0deg", "360deg"],
    });
    return (
      <Animated.View style={{ transform: [{ rotate: spin }] }}>
        <CircleNotch size={size} weight="bold" color={colors.accent[9]} />
      </Animated.View>
    );
  }

  if (status === "started") {
    return <CircleIcon size={size} weight="duotone" color={colors.accent[9]} />;
  }

  // Backlog / no run yet
  return (
    <View style={{ opacity: 0.7 }}>
      <CircleIcon size={size} weight="regular" color={colors.gray[9]} />
    </View>
  );
}

export const TaskStatusIcon = memo(TaskStatusIconComponent);

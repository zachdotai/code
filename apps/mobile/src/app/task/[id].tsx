import { Text } from "@components/text";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Pressable,
  View,
} from "react-native";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getTask, runTaskInCloud } from "@/features/tasks/api";
import { TaskSessionView } from "@/features/tasks/components/TaskSessionView";
import { DotBackground } from "@/features/tasks/composer/DotBackground";
import {
  DEFAULT_EXECUTION_MODE,
  DEFAULT_MODEL,
  DEFAULT_REASONING,
  type ExecutionMode,
  modelSupportsReasoning,
  type ReasoningEffort,
} from "@/features/tasks/composer/options";
import { TaskChatComposer } from "@/features/tasks/composer/TaskChatComposer";
import { taskKeys } from "@/features/tasks/hooks/useTasks";
import { useTaskSessionStore } from "@/features/tasks/stores/taskSessionStore";
import { useTaskStore } from "@/features/tasks/stores/taskStore";
import type { Task } from "@/features/tasks/types";
import { logger } from "@/lib/logger";
import { useThemeColors } from "@/lib/theme";

const log = logger.scope("task-detail");

export default function TaskDetailScreen() {
  const {
    id: taskId,
    fromAutomation,
    automationName,
  } = useLocalSearchParams<{
    id: string;
    fromAutomation?: string;
    automationName?: string;
  }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const themeColors = useThemeColors();
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const {
    connectToTask,
    disconnectFromTask,
    sendPrompt,
    cancelPrompt,
    sendPermissionResponse,
    setConfigOption,
    getSessionForTask,
    setFocusedTaskId,
  } = useTaskSessionStore();

  useEffect(() => {
    if (!taskId) return;
    setFocusedTaskId(taskId);
    return () => setFocusedTaskId(null);
  }, [taskId, setFocusedTaskId]);

  const session = taskId ? getSessionForTask(taskId) : undefined;

  // Per-task composer pill values. Persisted in taskStore so reopening the
  // task keeps the user's choices; defaults fall back to the same constants
  // the new-task composer uses.
  const composerConfig = useTaskStore((s) =>
    taskId ? s.composerConfigByTaskId[taskId] : undefined,
  );
  const setComposerConfig = useTaskStore((s) => s.setComposerConfig);
  const composerMode: ExecutionMode =
    composerConfig?.mode ?? DEFAULT_EXECUTION_MODE;
  const composerModel = composerConfig?.model ?? DEFAULT_MODEL;
  const composerReasoning: ReasoningEffort =
    composerConfig?.reasoning ?? DEFAULT_REASONING;

  const { height } = useReanimatedKeyboardAnimation();

  // useReanimatedKeyboardAnimation returns negative height values
  // e.g., -300 when keyboard is open, 0 when closed
  const contentPosition = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: height.value }],
    };
  }, []);

  const inputContainerStyle = useAnimatedStyle(() => {
    // contentPosition already translates the whole content up by the keyboard
    // height, so the composer sits at the keyboard top — no extra gap needed
    // when open. Closed state keeps a comfortable bottom inset.
    return {
      marginBottom: height.value < 0 ? 0 : Math.max(insets.bottom, 50),
    };
  }, [insets.bottom]);

  useEffect(() => {
    if (!taskId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    getTask(taskId)
      .then((fetchedTask) => {
        if (cancelled) return;
        setTask(fetchedTask);
        return connectToTask(fetchedTask);
      })
      .catch((err) => {
        if (cancelled) return;
        log.error("Failed to load task", err);
        setError("Failed to load task");
      })
      .finally(() => {
        if (cancelled) return;
        // Brief delay for FlatList to render its initial batch behind
        // the loading overlay before revealing.
        setTimeout(() => setLoading(false), 150);
      });

    return () => {
      cancelled = true;
      disconnectFromTask(taskId);
    };
  }, [taskId, connectToTask, disconnectFromTask]);

  // Auto-reconnect if the session disappears while the screen is active
  // (e.g., cloud sandbox expired and the session was cleaned up).
  // Re-fetches the task to get a fresh S3 presigned URL.
  useEffect(() => {
    if (!taskId || !task || loading) return;
    if (session) return;
    if (retrying) return;

    let cancelled = false;
    getTask(taskId)
      .then((freshTask) => {
        if (cancelled) return;
        setTask(freshTask);
        return connectToTask(freshTask);
      })
      .catch((err) => {
        if (cancelled) return;
        log.error("Failed to reconnect to task", err);
      });

    return () => {
      cancelled = true;
    };
  }, [taskId, task, loading, session, connectToTask, retrying]);

  const updateTaskInCache = useCallback(
    (updated: Task) => {
      // Directly patch the task in all list query caches so the task list
      // reflects the change immediately (e.g., environment: local → cloud).
      queryClient.setQueriesData<Task[]>(
        { queryKey: taskKeys.lists() },
        (old) => old?.map((t) => (t.id === updated.id ? updated : t)),
      );
    },
    [queryClient],
  );

  // Resume a terminal (completed/failed) run with a new user prompt. Mirrors
  // the desktop "send on a finished task continues the conversation" UX —
  // creates a fresh run that resumes from the previous one and queues the
  // message as pending_user_message.
  const handleSendAfterTerminal = useCallback(
    async (text: string) => {
      if (!taskId || !task) return;
      try {
        setRetrying(true);
        disconnectFromTask(taskId);

        const supportsReasoning = modelSupportsReasoning(composerModel);
        const updatedTask = await runTaskInCloud(taskId, {
          resumeFromRunId: task.latest_run?.id,
          pendingUserMessage: text,
          runtimeAdapter: "claude",
          model: composerModel,
          reasoningEffort: supportsReasoning ? composerReasoning : undefined,
          initialPermissionMode: composerMode,
        });
        setTask(updatedTask);
        await connectToTask(updatedTask);
        updateTaskInCache(updatedTask);
      } catch (err) {
        log.error("Failed to send after terminal", err);
        setRetrying(false);
        Alert.alert(
          "Failed to send",
          "Could not continue this task. Please try again.",
        );
      }
    },
    [
      taskId,
      task,
      disconnectFromTask,
      connectToTask,
      updateTaskInCache,
      composerMode,
      composerModel,
      composerReasoning,
    ],
  );

  const handleSendPrompt = useCallback(
    (text: string) => {
      if (!taskId) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      if (session?.terminalStatus) {
        handleSendAfterTerminal(text);
        return;
      }

      sendPrompt(taskId, text).catch((err) => {
        log.error("Failed to send prompt", err);
        Alert.alert(
          "Failed to send",
          "Your message could not be delivered. Please try again.",
        );
      });
    },
    [taskId, sendPrompt, session?.terminalStatus, handleSendAfterTerminal],
  );

  const handleModeChange = useCallback(
    (value: ExecutionMode) => {
      if (!taskId) return;
      setComposerConfig(taskId, { mode: value });
      // Push to the live cloud session so the next turn uses the new mode.
      // Silently ignore failures — value is already persisted locally and
      // will be replayed if the user resumes from a terminal state.
      setConfigOption(taskId, "mode", value).catch(() => {});
    },
    [taskId, setComposerConfig, setConfigOption],
  );

  const handleModelChange = useCallback(
    (value: string) => {
      if (!taskId) return;
      setComposerConfig(taskId, { model: value });
      setConfigOption(taskId, "model", value).catch(() => {});
    },
    [taskId, setComposerConfig, setConfigOption],
  );

  const handleReasoningChange = useCallback(
    (value: ReasoningEffort) => {
      if (!taskId) return;
      setComposerConfig(taskId, { reasoning: value });
      setConfigOption(taskId, "effort", value).catch(() => {});
    },
    [taskId, setComposerConfig, setConfigOption],
  );

  const handleStop = useCallback(() => {
    if (!taskId) return;
    // cancelPrompt returns false on failure — no need to alert,
    // the agent may have already finished or the sandbox expired.
    cancelPrompt(taskId).catch(() => {});
  }, [taskId, cancelPrompt]);

  const handleRetry = useCallback(async () => {
    if (!taskId || !task) return;
    try {
      setRetrying(true);
      disconnectFromTask(taskId);

      const updatedTask = await runTaskInCloud(taskId, {
        resumeFromRunId: task.latest_run?.id,
      });
      setTask(updatedTask);
      await connectToTask(updatedTask);
      updateTaskInCache(updatedTask);
      // Don't clear retrying here — the effect below clears it
      // once the session shows meaningful state (thinking or terminal).
    } catch (err) {
      log.error("Failed to retry task", err);
      setRetrying(false);
      Alert.alert(
        "Retry failed",
        "Could not restart the task. Please try again.",
      );
    }
  }, [taskId, task, disconnectFromTask, connectToTask, updateTaskInCache]);

  // Clear retrying once the agent finishes a turn or the run terminates.
  useEffect(() => {
    if (!retrying || !session) return;
    if (!session.isPromptPending || session.terminalStatus) {
      setRetrying(false);
    }
  }, [retrying, session]);

  const handleSendPermissionResponse = useCallback(
    (args: Parameters<typeof sendPermissionResponse>[1]) => {
      if (!taskId) return;
      sendPermissionResponse(taskId, args).catch((err) => {
        log.error("Failed to send permission response", err);
        Alert.alert(
          "Failed to respond",
          "Your permission response could not be sent. Please try again.",
        );
      });
    },
    [taskId, sendPermissionResponse],
  );

  const handleOpenTask = useCallback(
    (newTaskId: string) => {
      router.replace(`/task/${newTaskId}`);
    },
    [router],
  );

  // Stale detection for local tasks: if no new S3 data arrives for 30s
  // while the agent is supposedly working, the desktop may be offline.
  const isLocal = task?.latest_run?.environment === "local";
  const [isStale, setIsStale] = useState(false);
  useEffect(() => {
    if (!isLocal || !session?.isPromptPending) {
      setIsStale(false);
      return;
    }
    const interval = setInterval(() => {
      const lastEvent = session.lastEventAt ?? 0;
      setIsStale(lastEvent > 0 && Date.now() - lastEvent > 30_000);
    }, 5_000);
    return () => clearInterval(interval);
  }, [isLocal, session?.isPromptPending, session?.lastEventAt]);

  const handleContinueInCloud = useCallback(async () => {
    if (!taskId || !task) return;
    try {
      setRetrying(true);
      disconnectFromTask(taskId);
      const updatedTask = await runTaskInCloud(taskId, {
        resumeFromRunId: task.latest_run?.id,
      });
      setTask(updatedTask);
      await connectToTask(updatedTask);
      updateTaskInCache(updatedTask);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      log.error("Failed to continue in cloud", err);
      setRetrying(false);
      Alert.alert(
        "Failed to switch",
        "Could not continue this task in the cloud. Please try again.",
      );
    }
  }, [taskId, task, disconnectFromTask, connectToTask, updateTaskInCache]);

  const visibleAgentTypes = [
    "agent_message_chunk",
    "agent_message",
    "agent_thought_chunk",
    "tool_call",
  ];
  const hasAnyAgentOutput =
    session?.events.some((e) => {
      if (e.type !== "session_update") return false;
      const su = (e.notification as Record<string, unknown>)?.update;
      return visibleAgentTypes.includes(
        (su as Record<string, unknown>)?.sessionUpdate as string,
      );
    }) ?? false;

  const isConnecting =
    retrying || (!!session?.awaitingAgentOutput && !hasAnyAgentOutput);
  const isThinking = !!session?.awaitingAgentOutput && hasAnyAgentOutput;
  const showAutomationContext =
    fromAutomation === "1" || task?.origin_product === "automation";
  const automationContextLabel =
    automationName ??
    (task?.origin_product === "automation"
      ? "This run was started from a task automation."
      : null);

  // Haptic pulse when connecting/thinking indicators dismiss
  const prevWaiting = useRef(false);
  useEffect(() => {
    const waiting = isConnecting || isThinking;
    if (prevWaiting.current && !waiting) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    prevWaiting.current = waiting;
  }, [isConnecting, isThinking]);

  if (error || (!task && !loading)) {
    return (
      <>
        <Stack.Screen
          options={{
            headerShown: true,
            headerTransparent: false,
            headerTitle: "Error",
            headerStyle: { backgroundColor: themeColors.background },
            headerTintColor: themeColors.gray[12],
            presentation: "modal",
          }}
        />
        <View className="flex-1 items-center justify-center bg-background px-4">
          <Text className="mb-4 text-center text-status-error">
            {error || "Task not found"}
          </Text>
          <Pressable
            onPress={() => router.back()}
            className="rounded-lg bg-gray-3 px-4 py-2"
          >
            <Text className="text-gray-12">Go back</Text>
          </Pressable>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTransparent: false,
          headerTitle: loading ? "Loading..." : task?.title || "Task",
          headerStyle: { backgroundColor: themeColors.background },
          headerTintColor: themeColors.gray[12],
          headerTitleStyle: {
            fontWeight: "600",
          },
          presentation: "modal",
          headerRight: isLocal
            ? () => (
                <Pressable
                  onPress={() =>
                    ActionSheetIOS.showActionSheetWithOptions(
                      {
                        options: ["Keep locally", "Move to Cloud"],
                        cancelButtonIndex: 0,
                        title: isStale
                          ? "Desktop may be offline"
                          : "Running on your desktop",
                      },
                      (index) => {
                        if (index === 1) handleContinueInCloud();
                      },
                    )
                  }
                  className="rounded-full bg-gray-4 px-3 py-1"
                >
                  <Text className="font-medium text-gray-11 text-xs">
                    Local
                  </Text>
                </Pressable>
              )
            : undefined,
        }}
      />
      <View className="flex-1 bg-background">
        {/* Subtle dotted background — matches the new-task screen. Sits below
            the translated content so it stays put when the keyboard opens. */}
        <DotBackground />
        <Animated.View className="flex-1" style={contentPosition}>
          {showAutomationContext && automationContextLabel && (
            <View className="absolute inset-x-3 top-3 z-10 rounded-lg border border-accent-6 bg-accent-2 px-3 py-2">
              <Text className="text-accent-11 text-xs">
                {automationName
                  ? `Started from automation: ${automationName}`
                  : automationContextLabel}
              </Text>
            </View>
          )}

          {/* Always render TaskSessionView so the FlatList can layout behind
              the loading overlay. This prevents the "flash of messages" when
              switching from loading spinner to rendered content. */}
          <TaskSessionView
            events={session?.events ?? []}
            isConnecting={isConnecting}
            isThinking={isThinking}
            terminalStatus={retrying ? undefined : session?.terminalStatus}
            lastError={retrying ? undefined : session?.lastError}
            onRetry={
              !retrying && session?.terminalStatus ? handleRetry : undefined
            }
            onOpenTask={handleOpenTask}
            onSendPermissionResponse={handleSendPermissionResponse}
            contentContainerStyle={{
              paddingTop:
                session?.terminalStatus && !retrying
                  ? 16 + (showAutomationContext ? 44 : 0)
                  : 80 + insets.bottom + (showAutomationContext ? 44 : 0),
              paddingBottom: 16,
            }}
          />

          {/* Loading overlay — covers the list while it does initial layout */}
          {loading && (
            <View className="absolute inset-0 items-center justify-center bg-background">
              <ActivityIndicator size="large" color={themeColors.accent[9]} />
              <Text className="mt-4 text-gray-11">
                {task?.latest_run ? "Connecting..." : "Loading task..."}
              </Text>
            </View>
          )}

          {/* Fixed composer at bottom — stays visible even on terminal runs so
              the user can send a follow-up message that resumes the task. */}
          <Animated.View
            className="absolute inset-x-0 bottom-0"
            style={inputContainerStyle}
          >
            <TaskChatComposer
              onSend={handleSendPrompt}
              onStop={handleStop}
              isUserTurn={!(session?.isPromptPending ?? true)}
              placeholder={
                session?.terminalStatus
                  ? "Resume this task..."
                  : "Ask a question"
              }
              mode={composerMode}
              model={composerModel}
              reasoning={composerReasoning}
              onModeChange={handleModeChange}
              onModelChange={handleModelChange}
              onReasoningChange={handleReasoningChange}
            />
          </Animated.View>
        </Animated.View>
      </View>
    </>
  );
}

import { Text } from "@components/text";
import * as WebBrowser from "expo-web-browser";
import { CaretRight, GitBranch } from "phosphor-react-native";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  View,
} from "react-native";
import { useAuthStore } from "@/features/auth";
import { useThemeColors } from "@/lib/theme";
import { useIntegrations } from "../hooks/useIntegrations";
import { useTasks } from "../hooks/useTasks";
import { useArchivedTasksStore } from "../stores/archivedTasksStore";
import type { Task } from "../types";
import { SwipeableTaskItem } from "./SwipeableTaskItem";

interface TaskListProps {
  onTaskPress?: (taskId: string) => void;
  onCreateTask?: () => void;
}

interface ConnectGitHubEmptyStateProps {
  onConnected?: () => void;
}

function ConnectGitHubEmptyState({
  onConnected,
}: ConnectGitHubEmptyStateProps) {
  const { cloudRegion, projectId, getCloudUrlFromRegion } = useAuthStore();
  const themeColors = useThemeColors();

  const handleConnectGitHub = async () => {
    if (!cloudRegion || !projectId) return;
    const baseUrl = getCloudUrlFromRegion(cloudRegion);
    // Use the authorize endpoint which redirects to GitHub App installation
    const authorizeUrl = `${baseUrl}/api/environments/${projectId}/integrations/authorize/?kind=github`;

    // Open in-app browser - will auto-detect when user returns
    const result = await WebBrowser.openAuthSessionAsync(
      authorizeUrl,
      "posthog://github/callback",
    );

    // When browser session ends (dismiss, cancel, or redirect), refresh integrations
    if (
      result.type === "dismiss" ||
      result.type === "cancel" ||
      result.type === "success"
    ) {
      onConnected?.();
    }
  };

  return (
    <View className="flex-1 items-center justify-center p-6">
      <View className="mb-6 h-16 w-16 items-center justify-center rounded-full bg-gray-3">
        <Text className="text-3xl">🔗</Text>
      </View>
      <Text className="mb-2 text-center font-semibold text-gray-12 text-lg">
        Connect GitHub
      </Text>
      <Text className="mb-6 text-center text-gray-11 text-sm">
        Let PostHog work on your repositories.
      </Text>
      <Pressable
        onPress={handleConnectGitHub}
        className="rounded-lg px-6 py-3"
        style={{ backgroundColor: themeColors.accent[9] }}
      >
        <Text className="font-semibold text-accent-contrast">
          Connect GitHub
        </Text>
      </Pressable>
    </View>
  );
}

interface CreateTaskEmptyStateProps {
  onCreateTask?: () => void;
}

function CreateTaskEmptyState({ onCreateTask }: CreateTaskEmptyStateProps) {
  const themeColors = useThemeColors();

  return (
    <View className="flex-1 items-center justify-center p-6">
      <View className="mb-6 h-16 w-16 items-center justify-center rounded-full bg-gray-3">
        <Text className="text-3xl">✨</Text>
      </View>
      <Text className="mb-2 text-center font-semibold text-gray-12 text-lg">
        No tasks yet
      </Text>
      <Text className="mb-6 text-center text-gray-11 text-sm">
        Create your first task to get PostHog working.
      </Text>
      {onCreateTask && (
        <Pressable
          onPress={onCreateTask}
          className="rounded-lg px-6 py-3"
          style={{ backgroundColor: themeColors.accent[9] }}
        >
          <Text className="font-semibold text-accent-contrast">
            Create task
          </Text>
        </Pressable>
      )}
    </View>
  );
}

type ListItem =
  | { type: "task"; task: Task; isArchived: boolean }
  | { type: "repo-header"; repoLabel: string; count: number }
  | { type: "archived-header"; count: number; expanded: boolean };

const NO_REPO_LABEL = "No repository";

function repoSortKey(task: Task): number {
  // Most recent activity first within a group.
  const ts = task.latest_run?.updated_at ?? task.updated_at ?? task.created_at;
  return -new Date(ts).getTime();
}

export function TaskList({ onTaskPress, onCreateTask }: TaskListProps) {
  const { tasks, isLoading, error, refetch } = useTasks();
  const { hasGithubIntegration, refetch: refetchIntegrations } =
    useIntegrations();
  const themeColors = useThemeColors();
  const { archivedTasks, archive, unarchive } = useArchivedTasksStore();
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [scrollEnabled, setScrollEnabled] = useState(true);

  const handleTaskPress = (task: Task) => {
    onTaskPress?.(task.id);
  };

  const handleRefresh = async () => {
    await Promise.all([refetch(), refetchIntegrations()]);
  };

  const listItems = useMemo((): ListItem[] => {
    const active: Task[] = [];
    const archived: Task[] = [];

    for (const task of tasks) {
      if (task.id in archivedTasks) {
        archived.push(task);
      } else {
        active.push(task);
      }
    }

    // Sort archived by FIFO (earliest archived first)
    archived.sort(
      (a, b) => (archivedTasks[a.id] ?? 0) - (archivedTasks[b.id] ?? 0),
    );

    // Group active tasks by repository.
    const groups = new Map<string, Task[]>();
    for (const task of active) {
      const key = task.repository?.trim() || NO_REPO_LABEL;
      const bucket = groups.get(key);
      if (bucket) {
        bucket.push(task);
      } else {
        groups.set(key, [task]);
      }
    }

    // Sort each group's tasks by most-recent activity.
    for (const tasksInRepo of groups.values()) {
      tasksInRepo.sort((a, b) => repoSortKey(a) - repoSortKey(b));
    }

    // Order groups: most-recently-active repo first; "No repository" last.
    const groupEntries = Array.from(groups.entries()).sort((a, b) => {
      if (a[0] === NO_REPO_LABEL) return 1;
      if (b[0] === NO_REPO_LABEL) return -1;
      return repoSortKey(a[1][0]) - repoSortKey(b[1][0]);
    });

    const items: ListItem[] = [];
    for (const [repoLabel, tasksInRepo] of groupEntries) {
      items.push({
        type: "repo-header",
        repoLabel,
        count: tasksInRepo.length,
      });
      for (const task of tasksInRepo) {
        items.push({ type: "task", task, isArchived: false });
      }
    }

    if (archived.length > 0) {
      items.push({
        type: "archived-header",
        count: archived.length,
        expanded: archivedExpanded,
      });

      if (archivedExpanded) {
        for (const task of archived) {
          items.push({ type: "task", task, isArchived: true });
        }
      }
    }

    return items;
  }, [tasks, archivedTasks, archivedExpanded]);

  if (error) {
    return (
      <View className="flex-1 items-center justify-center p-6">
        <Text className="mb-4 text-center text-status-error">{error}</Text>
        <Pressable
          onPress={handleRefresh}
          className="rounded-lg bg-gray-3 px-4 py-2"
        >
          <Text className="text-gray-12">Retry</Text>
        </Pressable>
      </View>
    );
  }

  // Show loading while tasks are loading OR while we haven't checked integrations yet (when no tasks)
  const isInitialLoading =
    (isLoading && tasks.length === 0) ||
    (tasks.length === 0 && hasGithubIntegration === null);

  if (isInitialLoading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color={themeColors.accent[9]} />
        <Text className="mt-4 text-gray-11">Loading tasks...</Text>
      </View>
    );
  }

  // No GitHub connection and no tasks - prompt to connect GitHub
  if (hasGithubIntegration === false && tasks.length === 0) {
    return <ConnectGitHubEmptyState onConnected={handleRefresh} />;
  }

  // Has GitHub connection but no tasks - prompt to create first task
  if (tasks.length === 0) {
    return <CreateTaskEmptyState onCreateTask={onCreateTask} />;
  }

  return (
    <FlatList
      scrollEnabled={scrollEnabled}
      data={listItems}
      keyExtractor={(item) => {
        switch (item.type) {
          case "archived-header":
            return "__archived_header__";
          case "repo-header":
            return `__repo__${item.repoLabel}`;
          case "task":
            return `${item.task.id}-${item.isArchived ? "a" : "v"}`;
        }
      }}
      renderItem={({ item }) => {
        if (item.type === "repo-header") {
          return (
            <View className="flex-row items-center gap-2 bg-gray-2 px-3 py-2">
              <GitBranch size={14} color={themeColors.gray[10]} />
              <Text
                className="flex-1 font-medium text-[12px] text-gray-11"
                numberOfLines={1}
              >
                {item.repoLabel}
              </Text>
              <Text className="text-[11px] text-gray-9">{item.count}</Text>
            </View>
          );
        }

        if (item.type === "archived-header") {
          return (
            <Pressable
              onPress={() => setArchivedExpanded(!item.expanded)}
              className="flex-row items-center gap-2 border-gray-6 border-t bg-gray-2 px-3 py-2.5"
            >
              <CaretRight
                size={14}
                color={themeColors.gray[9]}
                style={{
                  transform: [{ rotate: item.expanded ? "90deg" : "0deg" }],
                }}
              />
              <Text className="flex-1 font-medium text-gray-9 text-xs">
                Archived
              </Text>
              <Text className="text-gray-8 text-xs">{item.count}</Text>
            </Pressable>
          );
        }

        return (
          <SwipeableTaskItem
            task={item.task}
            isArchived={item.isArchived}
            onPress={handleTaskPress}
            onArchive={archive}
            onUnarchive={unarchive}
            onSwipeStart={() => setScrollEnabled(false)}
            onSwipeEnd={() => setScrollEnabled(true)}
          />
        );
      }}
      refreshControl={
        <RefreshControl
          refreshing={isLoading}
          onRefresh={handleRefresh}
          tintColor={themeColors.accent[9]}
        />
      }
      contentContainerStyle={{ paddingBottom: 100 }}
    />
  );
}

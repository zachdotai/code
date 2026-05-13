import { Text } from "@components/text";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  View,
} from "react-native";
import { useThemeColors } from "@/lib/theme";
import { useAutomations } from "../hooks/useAutomations";
import { useIntegrations } from "../hooks/useIntegrations";
import { useTasks } from "../hooks/useTasks";
import type { TaskAutomation } from "../types";
import { AutomationItem } from "./AutomationItem";
import { GitHubConnectionPrompt } from "./GitHubConnectionPrompt";

interface AutomationListProps {
  onAutomationPress?: (automationId: string) => void;
  onCreateAutomation?: () => void;
}

function EmptyAutomationState({
  onCreateAutomation,
}: Pick<AutomationListProps, "onCreateAutomation">) {
  const themeColors = useThemeColors();

  return (
    <View className="flex-1 items-center justify-center p-6">
      <Text className="mb-2 text-center font-semibold text-gray-12 text-lg">
        No automations yet
      </Text>
      <Text className="mb-6 text-center text-gray-11 text-sm">
        Schedule recurring tasks
      </Text>
      {onCreateAutomation && (
        <Pressable
          onPress={onCreateAutomation}
          className="rounded-lg px-6 py-3"
          style={{ backgroundColor: themeColors.accent[9] }}
        >
          <Text className="font-semibold text-accent-contrast">
            Create automation
          </Text>
        </Pressable>
      )}
    </View>
  );
}

export function AutomationList({
  onAutomationPress,
  onCreateAutomation,
}: AutomationListProps) {
  const { automations, isLoading, error, refetch } = useAutomations();
  const { allTasks: automationTasks } = useTasks({
    originProduct: "automation",
  });
  const {
    error: integrationsError,
    hasGithubIntegration,
    refetch: refetchIntegrations,
  } = useIntegrations();
  const themeColors = useThemeColors();

  const handleRefresh = async () => {
    await Promise.all([refetch(), refetchIntegrations()]);
  };

  const handleAutomationPress = (automation: TaskAutomation) => {
    onAutomationPress?.(automation.id);
  };

  const taskStatusById = new Map(
    automationTasks.map((task) => [task.id, task.latest_run?.status ?? null]),
  );

  const isInitialLoading =
    (isLoading && automations.length === 0) ||
    (automations.length === 0 && hasGithubIntegration === null);

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

  if (integrationsError && automations.length === 0) {
    return (
      <View className="flex-1 items-center justify-center p-6">
        <Text className="mb-4 text-center text-status-error">
          {integrationsError}
        </Text>
        <Pressable
          onPress={handleRefresh}
          className="rounded-lg bg-gray-3 px-4 py-2"
        >
          <Text className="text-gray-12">Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (isInitialLoading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color={themeColors.accent[9]} />
        <Text className="mt-4 text-gray-11">Loading automations...</Text>
      </View>
    );
  }

  if (hasGithubIntegration === false && automations.length === 0) {
    return <GitHubConnectionPrompt mode="empty" onConnected={handleRefresh} />;
  }

  if (automations.length === 0) {
    return <EmptyAutomationState onCreateAutomation={onCreateAutomation} />;
  }

  return (
    <FlatList
      data={automations}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <AutomationItem
          automation={item}
          onPress={handleAutomationPress}
          lastTaskRunStatus={
            item.last_task_id
              ? (taskStatusById.get(item.last_task_id) ?? null)
              : null
          }
        />
      )}
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

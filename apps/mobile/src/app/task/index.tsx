import { Text } from "@components/text";
import { Stack, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { ArrowClockwise, Check } from "phosphor-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { usePreferencesStore } from "@/features/preferences/stores/preferencesStore";
import {
  createTask,
  runTaskInCloud,
  startGithubUserConnect,
} from "@/features/tasks";
import {
  useUserGithubBranches,
  useUserGithubRepositories,
  useUserRepositoryIntegration,
} from "@/features/tasks/hooks/useIntegrations";
import { logger } from "@/lib/logger";
import { useThemeColors } from "@/lib/theme";

const log = logger.scope("task-create");

interface ConnectGitHubPromptProps {
  onConnected?: () => void;
}

function ConnectGitHubPrompt({ onConnected }: ConnectGitHubPromptProps) {
  const themeColors = useThemeColors();
  const [starting, setStarting] = useState(false);

  const handleConnectGitHub = async () => {
    if (starting) return;
    setStarting(true);
    try {
      const { install_url } = await startGithubUserConnect();

      const result = await WebBrowser.openAuthSessionAsync(
        install_url,
        "posthog://github/callback",
      );

      if (
        result.type === "dismiss" ||
        result.type === "cancel" ||
        result.type === "success"
      ) {
        onConnected?.();
      }
    } catch (error) {
      log.error("Failed to start GitHub connect", error);
    } finally {
      setStarting(false);
    }
  };

  return (
    <View className="mb-4 rounded-lg border border-gray-6 p-4">
      <View className="mb-3 flex-row items-center">
        <Text className="mr-2 text-xl">🔗</Text>
        <Text className="font-semibold text-gray-12">
          Connect GitHub to continue
        </Text>
      </View>
      <Text className="mb-4 text-gray-11 text-sm">
        You need to connect your GitHub account before creating tasks. This
        allows PostHog to work on your repositories.
      </Text>
      <Pressable
        onPress={handleConnectGitHub}
        className="items-center rounded-lg py-3"
        style={{ backgroundColor: themeColors.accent[9] }}
      >
        <Text className="font-semibold text-accent-contrast">
          Connect GitHub
        </Text>
      </Pressable>
    </View>
  );
}

interface SelectableListProps {
  items: string[];
  selectedValue: string | null;
  onSelect: (value: string) => void;
  emptyText: string;
  searchActive: boolean;
  isRefreshing: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  isFetchingMore?: boolean;
}

function SelectableList({
  items,
  selectedValue,
  onSelect,
  emptyText,
  searchActive,
  isRefreshing,
  hasMore,
  onLoadMore,
  isFetchingMore,
}: SelectableListProps) {
  const themeColors = useThemeColors();

  return (
    <ScrollView
      className="mb-4 max-h-48 rounded-lg border border-gray-6"
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
    >
      {items.length === 0 && !isRefreshing ? (
        <View className="px-3 py-4">
          <Text className="text-center text-gray-9 text-sm">
            {searchActive ? "No matches" : emptyText}
          </Text>
        </View>
      ) : (
        <>
          {items.map((item) => {
            const selected = selectedValue === item;
            return (
              <Pressable
                key={item}
                onPress={() => onSelect(item)}
                className={`flex-row items-center justify-between border-gray-6 border-b px-3 py-3 ${
                  selected ? "bg-accent-3" : ""
                }`}
              >
                <Text
                  className={`flex-1 text-sm ${selected ? "text-accent-11" : "text-gray-11"}`}
                  numberOfLines={1}
                >
                  {item}
                </Text>
                {selected ? (
                  <Check size={14} color={themeColors.accent[11]} />
                ) : null}
              </Pressable>
            );
          })}
          {isRefreshing ? (
            <View className="items-center px-3 py-3">
              <ActivityIndicator size="small" color={themeColors.accent[9]} />
            </View>
          ) : null}
          {hasMore ? (
            <Pressable
              onPress={onLoadMore}
              disabled={isFetchingMore}
              className="items-center px-3 py-3"
            >
              {isFetchingMore ? (
                <ActivityIndicator size="small" color={themeColors.accent[9]} />
              ) : (
                <Text className="text-accent-11 text-sm">Load more</Text>
              )}
            </Pressable>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

export default function NewTaskScreen() {
  const router = useRouter();
  const themeColors = useThemeColors();

  const lastUsedCloudRepository = usePreferencesStore(
    (s) => s.lastUsedCloudRepository,
  );
  const setLastUsedCloudRepository = usePreferencesStore(
    (s) => s.setLastUsedCloudRepository,
  );

  const [repoSearch, setRepoSearch] = useState("");
  const [branchSearch, setBranchSearch] = useState("");
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(
    lastUsedCloudRepository?.toLowerCase() ?? null,
  );
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);

  const {
    repositories,
    getUserIntegrationIdForRepo,
    getInstallationIdForRepo,
    isLoadingRepos,
    isRefreshingRepos,
    refreshRepositories,
    hasGithubIntegration,
  } = useUserRepositoryIntegration();

  const trimmedRepoSearch = repoSearch.trim();
  const repoPickerActive = trimmedRepoSearch.length > 0;
  const {
    repositories: searchedRepositories,
    isPending: searchPending,
    isRefreshing: searchRefreshing,
    hasMore: searchHasMore,
    loadMore: loadMoreSearchedRepos,
  } = useUserGithubRepositories(repoSearch, repoPickerActive);

  const visibleRepositories = useMemo(() => {
    if (repoPickerActive) return searchedRepositories;
    return repositories;
  }, [repoPickerActive, repositories, searchedRepositories]);

  // Validate persisted selection against the loaded list; clear if missing.
  useEffect(() => {
    if (!selectedRepo) return;
    if (isLoadingRepos) return;
    if (!repositories.includes(selectedRepo)) {
      setSelectedRepo(null);
    }
  }, [selectedRepo, repositories, isLoadingRepos]);

  // Auto-select when there's exactly one repo (matches desktop GitHubRepoPicker).
  useEffect(() => {
    if (selectedRepo) return;
    if (repositories.length === 1) {
      setSelectedRepo(repositories[0]);
    }
  }, [selectedRepo, repositories]);

  const selectedInstallationId = selectedRepo
    ? getInstallationIdForRepo(selectedRepo)
    : undefined;

  const {
    data: branchData,
    isPending: branchesPending,
    isRefreshing: branchesRefreshing,
    isFetchingMore: branchesFetchingMore,
    hasMore: branchesHasMore,
    loadMore: loadMoreBranches,
    refresh: refreshBranches,
  } = useUserGithubBranches(
    selectedInstallationId,
    selectedRepo,
    branchSearch,
    !!selectedRepo,
  );

  const branches = branchData?.branches ?? [];
  const defaultBranch = branchData?.defaultBranch ?? null;

  // Pre-fill the default branch when one becomes available and no branch picked.
  useEffect(() => {
    if (selectedBranch) return;
    if (defaultBranch) {
      setSelectedBranch(defaultBranch);
    }
  }, [selectedBranch, defaultBranch]);

  // Reset branch when repo changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only on repo change
  useEffect(() => {
    setSelectedBranch(null);
    setBranchSearch("");
  }, [selectedRepo]);

  const handleSelectRepo = useCallback(
    (repo: string) => {
      const normalized = repo.toLowerCase();
      setSelectedRepo(normalized);
      setLastUsedCloudRepository(normalized);
    },
    [setLastUsedCloudRepository],
  );

  const handleRefreshRepos = useCallback(async () => {
    try {
      await refreshRepositories();
    } catch (error) {
      log.error("Failed to refresh repositories", error);
    }
  }, [refreshRepositories]);

  const handleRefreshBranches = useCallback(async () => {
    try {
      await refreshBranches();
    } catch (error) {
      log.error("Failed to refresh branches", error);
    }
  }, [refreshBranches]);

  const handleCreateTask = useCallback(async () => {
    if (!prompt.trim() || !selectedRepo) return;

    setCreating(true);
    try {
      const trimmedPrompt = prompt.trim();
      const userIntegrationId = getUserIntegrationIdForRepo(selectedRepo);
      const task = await createTask({
        description: trimmedPrompt,
        title: trimmedPrompt.slice(0, 100),
        repository: selectedRepo,
        github_user_integration: userIntegrationId,
      });

      await runTaskInCloud(task.id, {
        pendingUserMessage: trimmedPrompt,
        branch: selectedBranch ?? undefined,
      });

      router.replace(`/task/${task.id}`);
    } catch (error) {
      log.error("Failed to create task", error);
    } finally {
      setCreating(false);
    }
  }, [
    prompt,
    selectedRepo,
    selectedBranch,
    getUserIntegrationIdForRepo,
    router,
  ]);

  const canSubmit = !!prompt.trim() && !!selectedRepo && !creating;
  const showLoading = isLoadingRepos && !hasGithubIntegration;
  const branchSearchActive = branchSearch.trim().length > 0;
  const repoListLoading = repoPickerActive
    ? searchPending || searchRefreshing
    : isRefreshingRepos;

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: "New task",
          headerStyle: { backgroundColor: themeColors.background },
          headerTintColor: themeColors.gray[12],
          presentation: "modal",
        }}
      />
      <KeyboardAvoidingView
        className="flex-1 bg-background"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={90}
      >
        <ScrollView
          className="flex-1 px-3 pt-4"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          <Pressable onPress={Keyboard.dismiss} accessible={false}>
            {showLoading ? (
              <View className="mb-4 items-center rounded-lg border border-gray-6 p-4">
                <ActivityIndicator size="small" color={themeColors.accent[9]} />
                <Text className="mt-2 text-gray-11 text-sm">
                  Loading repositories...
                </Text>
              </View>
            ) : !hasGithubIntegration ? (
              <ConnectGitHubPrompt onConnected={() => refreshRepositories()} />
            ) : (
              <>
                <View className="mb-2 flex-row items-center justify-between">
                  <Text className="text-gray-9 text-xs">Repository</Text>
                  <Pressable
                    onPress={handleRefreshRepos}
                    disabled={isRefreshingRepos}
                    hitSlop={8}
                    accessibilityLabel="Refresh repositories"
                  >
                    <ArrowClockwise
                      size={14}
                      color={themeColors.gray[11]}
                      style={isRefreshingRepos ? { opacity: 0.5 } : undefined}
                    />
                  </Pressable>
                </View>
                <TextInput
                  className="mb-2 rounded-lg border border-gray-6 px-3 py-2 text-gray-12 text-sm"
                  placeholder="Search repositories"
                  placeholderTextColor={themeColors.gray[9]}
                  value={repoSearch}
                  onChangeText={setRepoSearch}
                  autoCapitalize="none"
                  autoCorrect={false}
                  clearButtonMode="while-editing"
                />
                <SelectableList
                  items={visibleRepositories}
                  selectedValue={selectedRepo}
                  onSelect={handleSelectRepo}
                  emptyText="No repositories available"
                  searchActive={repoPickerActive}
                  isRefreshing={repoListLoading}
                  hasMore={repoPickerActive ? searchHasMore : false}
                  onLoadMore={loadMoreSearchedRepos}
                  isFetchingMore={searchRefreshing}
                />

                {selectedRepo ? (
                  <>
                    <View className="mb-2 flex-row items-center justify-between">
                      <Text className="text-gray-9 text-xs">Branch</Text>
                      <Pressable
                        onPress={handleRefreshBranches}
                        disabled={branchesRefreshing}
                        hitSlop={8}
                        accessibilityLabel="Refresh branches"
                      >
                        <ArrowClockwise
                          size={14}
                          color={themeColors.gray[11]}
                          style={
                            branchesRefreshing ? { opacity: 0.5 } : undefined
                          }
                        />
                      </Pressable>
                    </View>
                    <TextInput
                      className="mb-2 rounded-lg border border-gray-6 px-3 py-2 text-gray-12 text-sm"
                      placeholder={
                        defaultBranch
                          ? `Search branches (default: ${defaultBranch})`
                          : "Search branches"
                      }
                      placeholderTextColor={themeColors.gray[9]}
                      value={branchSearch}
                      onChangeText={setBranchSearch}
                      autoCapitalize="none"
                      autoCorrect={false}
                      clearButtonMode="while-editing"
                    />
                    <SelectableList
                      items={branches}
                      selectedValue={selectedBranch}
                      onSelect={setSelectedBranch}
                      emptyText={
                        branchesPending
                          ? "Loading branches..."
                          : "No branches available"
                      }
                      searchActive={branchSearchActive}
                      isRefreshing={branchesPending || branchesRefreshing}
                      hasMore={branchesHasMore}
                      onLoadMore={loadMoreBranches}
                      isFetchingMore={branchesFetchingMore}
                    />
                  </>
                ) : null}

                <Text className="mb-2 text-gray-9 text-xs">
                  Task description
                </Text>
                <TextInput
                  className="mb-4 min-h-[100px] rounded-lg border border-gray-6 px-3 py-3 font-mono text-gray-12 text-sm"
                  placeholder="What would you like the agent to do?"
                  placeholderTextColor={themeColors.gray[9]}
                  value={prompt}
                  onChangeText={setPrompt}
                  multiline
                  textAlignVertical="top"
                />

                <Pressable
                  onPress={handleCreateTask}
                  disabled={!canSubmit}
                  className={`rounded-lg py-3 ${canSubmit ? "bg-accent-9" : "bg-gray-3"}`}
                >
                  {creating ? (
                    <ActivityIndicator
                      size="small"
                      color={themeColors.accent.contrast}
                    />
                  ) : (
                    <Text
                      className={`text-center font-medium ${
                        canSubmit ? "text-accent-contrast" : "text-gray-9"
                      }`}
                    >
                      Create task
                    </Text>
                  )}
                </Pressable>
              </>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

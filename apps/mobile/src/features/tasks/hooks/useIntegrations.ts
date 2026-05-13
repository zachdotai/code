import {
  useInfiniteQuery,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useAuthStore } from "@/features/auth";
import {
  getGithubUserBranchesPage,
  getGithubUserIntegrations,
  getGithubUserRepositories,
  getGithubUserRepositoriesPage,
  refreshGithubUserRepositories,
} from "../api";
import type { GithubBranchesPage, UserGitHubIntegration } from "../types";

const REPOSITORIES_PAGE_SIZE = 50;
const BRANCHES_FIRST_PAGE_SIZE = 50;
const BRANCHES_PAGE_SIZE = 100;
const STALE_TIME_MS = 5 * 60 * 1000;

export const userGithubIntegrationKeys = {
  all: ["user-github-integrations"] as const,
  list: () => [...userGithubIntegrationKeys.all, "list"] as const,
  repositories: (installationId?: string) =>
    [...userGithubIntegrationKeys.all, "repositories", installationId] as const,
  repositoryPicker: (
    installationId?: string,
    search?: string,
    limit?: number,
  ) =>
    [
      ...userGithubIntegrationKeys.all,
      "repository-picker",
      installationId,
      search,
      limit,
    ] as const,
  branches: (installationId?: string, repo?: string | null, search?: string) =>
    [
      ...userGithubIntegrationKeys.all,
      "branches",
      installationId,
      repo,
      search,
    ] as const,
};

interface UserRepositoryIntegrationRef {
  userIntegrationId: string;
  installationId: string;
}

export function useUserGithubIntegrations() {
  const { projectId, oauthAccessToken } = useAuthStore();

  return useQuery({
    queryKey: userGithubIntegrationKeys.list(),
    queryFn: () => getGithubUserIntegrations(),
    enabled: !!projectId && !!oauthAccessToken,
    staleTime: STALE_TIME_MS,
  });
}

function useAllUserGithubRepositories(
  githubIntegrations: UserGitHubIntegration[],
) {
  const { oauthAccessToken } = useAuthStore();

  return useQueries({
    queries: githubIntegrations.map((integration) => ({
      queryKey: userGithubIntegrationKeys.repositories(
        integration.installation_id,
      ),
      queryFn: async () => {
        const repos = await getGithubUserRepositories(
          integration.installation_id,
        );
        return {
          userIntegrationId: integration.id,
          installationId: integration.installation_id,
          repos,
        };
      },
      enabled: !!oauthAccessToken,
      staleTime: STALE_TIME_MS,
    })),
    combine: (results) => {
      const map: Record<string, UserRepositoryIntegrationRef> = {};
      const reposByInstallationId: Record<string, string[]> = {};
      const failedInstallationIds: string[] = [];
      let pending = false;
      results.forEach((result, index) => {
        if (result.isPending) pending = true;
        if (result.isError) {
          const installationId =
            githubIntegrations[index]?.installation_id ?? null;
          if (installationId) failedInstallationIds.push(installationId);
        }
        if (!result.data) return;
        const installationRepos = result.data.repos ?? [];
        reposByInstallationId[result.data.installationId] = installationRepos;
        for (const repo of installationRepos) {
          if (!(repo in map)) {
            map[repo] = {
              userIntegrationId: result.data.userIntegrationId,
              installationId: result.data.installationId,
            };
          }
        }
      });
      return {
        repositoryMap: map,
        reposByInstallationId,
        isPending: pending,
        failedInstallationIds,
      };
    },
  });
}

export function useUserRepositoryIntegration() {
  const queryClient = useQueryClient();
  const { data: githubIntegrations = [], isPending: integrationsPending } =
    useUserGithubIntegrations();
  const [isRefreshingRepos, setIsRefreshingRepos] = useState(false);

  const {
    repositoryMap,
    reposByInstallationId,
    isPending: reposPending,
    failedInstallationIds,
  } = useAllUserGithubRepositories(githubIntegrations);

  const repositories = useMemo(
    () => Object.keys(repositoryMap),
    [repositoryMap],
  );

  const getUserIntegrationIdForRepo = useCallback(
    (repoKey: string) =>
      repositoryMap[repoKey?.toLowerCase()]?.userIntegrationId,
    [repositoryMap],
  );

  const getInstallationIdForRepo = useCallback(
    (repoKey: string) => repositoryMap[repoKey?.toLowerCase()]?.installationId,
    [repositoryMap],
  );

  const isRepoInIntegration = useCallback(
    (repoKey: string) => !repoKey || repoKey.toLowerCase() in repositoryMap,
    [repositoryMap],
  );

  const refreshRepositories = useCallback(async () => {
    if (!githubIntegrations.length) {
      return;
    }

    setIsRefreshingRepos(true);

    try {
      await Promise.all(
        githubIntegrations.map((integration) =>
          refreshGithubUserRepositories(integration.installation_id),
        ),
      );

      await Promise.all(
        githubIntegrations.map((integration) =>
          queryClient.refetchQueries({
            queryKey: userGithubIntegrationKeys.repositories(
              integration.installation_id,
            ),
            exact: true,
          }),
        ),
      );

      await queryClient.refetchQueries({
        queryKey: [...userGithubIntegrationKeys.all, "repository-picker"],
      });
    } finally {
      setIsRefreshingRepos(false);
    }
  }, [githubIntegrations, queryClient]);

  return {
    repositories,
    getUserIntegrationIdForRepo,
    getInstallationIdForRepo,
    isRepoInIntegration,
    isLoadingRepos: integrationsPending || reposPending,
    isRefreshingRepos,
    refreshRepositories,
    hasGithubIntegration: githubIntegrations.length > 0,
    failedInstallationIds,
    reposByInstallationId,
  };
}

export function useUserGithubRepositories(
  search?: string,
  enabled: boolean = true,
) {
  const { oauthAccessToken } = useAuthStore();
  const { data: githubIntegrations = [] } = useUserGithubIntegrations();
  const deferredSearch = useDeferredValue(search?.trim() ?? "");
  const [requestedLimit, setRequestedLimit] = useState(REPOSITORIES_PAGE_SIZE);
  const queryEnabled =
    enabled && !!oauthAccessToken && githubIntegrations.length > 0;

  useEffect(() => {
    setRequestedLimit(REPOSITORIES_PAGE_SIZE);
  }, []);

  const { repositoryMap, isPending, isRefreshing, hasMore } = useQueries({
    queries: githubIntegrations.map((integration) => ({
      queryKey: userGithubIntegrationKeys.repositoryPicker(
        integration.installation_id,
        deferredSearch,
        requestedLimit,
      ),
      queryFn: async () => {
        const page = await getGithubUserRepositoriesPage(
          integration.installation_id,
          0,
          requestedLimit,
          deferredSearch,
        );

        return {
          userIntegrationId: integration.id,
          installationId: integration.installation_id,
          ...page,
        };
      },
      enabled: queryEnabled,
      staleTime: STALE_TIME_MS,
      placeholderData: (prev: unknown) => prev,
    })),
    combine: (results) => {
      const map: Record<string, UserRepositoryIntegrationRef> = {};
      let pending = false;
      let refreshing = false;
      let hasMoreResults = false;

      for (const result of results) {
        if (result.isPending) pending = true;
        if (result.isRefetching) refreshing = true;
        if (!result.data) continue;

        if (result.data.hasMore) {
          hasMoreResults = true;
        }

        for (const repo of result.data.repositories ?? []) {
          if (!(repo in map)) {
            map[repo] = {
              userIntegrationId: result.data.userIntegrationId,
              installationId: result.data.installationId,
            };
          }
        }
      }

      return {
        repositoryMap: map,
        isPending: pending,
        isRefreshing: refreshing,
        hasMore: hasMoreResults,
      };
    },
  });

  const loadMore = useCallback(() => {
    setRequestedLimit((currentLimit) => currentLimit + REPOSITORIES_PAGE_SIZE);
  }, []);

  return {
    repositories: Object.keys(repositoryMap),
    isPending: queryEnabled ? isPending : false,
    isRefreshing: queryEnabled ? isRefreshing : false,
    hasMore,
    loadMore,
  };
}

export function useUserGithubBranches(
  installationId?: string,
  repo?: string | null,
  search?: string,
  enabled: boolean = true,
) {
  const { oauthAccessToken } = useAuthStore();
  const deferredSearch = useDeferredValue(search?.trim() ?? "");
  const queryEnabled =
    enabled && !!oauthAccessToken && !!installationId && !!repo;

  const query = useInfiniteQuery<
    GithubBranchesPage,
    Error,
    { pages: GithubBranchesPage[]; pageParams: number[] },
    ReturnType<typeof userGithubIntegrationKeys.branches>,
    number
  >({
    queryKey: userGithubIntegrationKeys.branches(
      installationId,
      repo,
      deferredSearch,
    ),
    queryFn: async ({ pageParam }) => {
      if (!installationId || !repo) {
        return { branches: [], defaultBranch: null, hasMore: false };
      }
      const pageSize =
        pageParam === 0 ? BRANCHES_FIRST_PAGE_SIZE : BRANCHES_PAGE_SIZE;
      return await getGithubUserBranchesPage(
        installationId,
        repo,
        pageParam,
        pageSize,
        deferredSearch,
      );
    },
    enabled: queryEnabled,
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore) return undefined;
      return allPages.reduce((n, p) => n + p.branches.length, 0);
    },
    staleTime: STALE_TIME_MS,
  });

  const data = useMemo(() => {
    if (!query.data?.pages.length) {
      return { branches: [] as string[], defaultBranch: null };
    }
    return {
      branches: query.data.pages.flatMap((p) => p.branches),
      defaultBranch: query.data.pages[0]?.defaultBranch ?? null,
    };
  }, [query.data?.pages]);

  const loadMore = useCallback(() => {
    if (!query.hasNextPage || query.isFetchingNextPage) {
      return;
    }

    void query.fetchNextPage();
  }, [query.fetchNextPage, query.hasNextPage, query.isFetchingNextPage]);

  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query.refetch]);

  return {
    data,
    isPending: queryEnabled ? query.isPending : false,
    isRefreshing: queryEnabled ? query.isRefetching : false,
    isFetchingMore: query.isFetchingNextPage,
    hasMore: query.hasNextPage ?? false,
    loadMore,
    refresh,
  };
}

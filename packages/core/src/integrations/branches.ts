export interface GithubBranchesPage {
  branches: string[];
  defaultBranch: string | null;
  hasMore: boolean;
}

export const BRANCHES_FIRST_PAGE_SIZE = 50;
export const BRANCHES_PAGE_SIZE = 100;

export function branchPageSizeForOffset(offset: number): number {
  return offset === 0 ? BRANCHES_FIRST_PAGE_SIZE : BRANCHES_PAGE_SIZE;
}

export function computeNextBranchOffset(
  lastPage: GithubBranchesPage,
  allPages: ReadonlyArray<GithubBranchesPage>,
): number | undefined {
  if (!lastPage.hasMore) return undefined;
  return allPages.reduce((total, page) => total + page.branches.length, 0);
}

export interface FlattenedBranches {
  branches: string[];
  defaultBranch: string | null;
}

export function flattenBranchPages(
  pages: ReadonlyArray<GithubBranchesPage> | undefined,
): FlattenedBranches {
  if (!pages || !pages.length) {
    return { branches: [], defaultBranch: null };
  }
  return {
    branches: pages.flatMap((page) => page.branches),
    defaultBranch: pages[0]?.defaultBranch ?? null,
  };
}

export interface CachedRepoBranches {
  branches: string[];
  defaultBranch: string | null;
}

/**
 * Persisted cold-start branch cache, keyed by normalized repo key. Key order
 * is least- to most-recently written; `resolveBranchCacheUpdate` evicts from
 * the front once the map exceeds `MAX_CACHED_BRANCH_REPOS`.
 */
export type CachedCloudBranchMap = Record<string, CachedRepoBranches>;

export const MAX_CACHED_BRANCH_REPOS = 20;

function isEmptyCachedBranches(entry: CachedRepoBranches | undefined): boolean {
  return !entry || (entry.branches.length === 0 && !entry.defaultBranch);
}

function sameCachedBranches(
  a: CachedRepoBranches,
  b: CachedRepoBranches,
): boolean {
  return (
    a.defaultBranch === b.defaultBranch &&
    a.branches.length === b.branches.length &&
    a.branches.every((branch, index) => branch === b.branches[index])
  );
}

export interface BranchCacheUpdateInputs {
  repoKey: string | null;
  searchActive: boolean;
  livePending: boolean;
  liveErrored: boolean;
  liveBranches: FlattenedBranches | null;
  cachedBranchMap: CachedCloudBranchMap;
}

/**
 * Decides how the persisted cold-start branch cache should track a settled
 * live fetch: returns the next map to persist, or null to leave the cache
 * untouched. Only the unsearched first page is cached, and the map is kept to
 * the `MAX_CACHED_BRANCH_REPOS` most recently fetched repos.
 */
export function resolveBranchCacheUpdate({
  repoKey,
  searchActive,
  livePending,
  liveErrored,
  liveBranches,
  cachedBranchMap,
}: BranchCacheUpdateInputs): CachedCloudBranchMap | null {
  if (!repoKey || searchActive || livePending || liveErrored || !liveBranches) {
    return null;
  }

  const entry: CachedRepoBranches = {
    branches: liveBranches.branches.slice(0, BRANCHES_FIRST_PAGE_SIZE),
    defaultBranch: liveBranches.defaultBranch,
  };

  const existing = cachedBranchMap[repoKey];
  if (isEmptyCachedBranches(entry)) {
    // A repo that cleanly reports no branches should not flash a stale list on
    // the next cold start.
    if (!existing) return null;
    const next: CachedCloudBranchMap = {};
    for (const key of Object.keys(cachedBranchMap)) {
      if (key !== repoKey) next[key] = cachedBranchMap[key];
    }
    return next;
  }

  const keys = Object.keys(cachedBranchMap);
  if (
    existing &&
    sameCachedBranches(existing, entry) &&
    keys.at(-1) === repoKey
  ) {
    return null;
  }

  const next: CachedCloudBranchMap = {};
  for (const key of keys) {
    if (key !== repoKey) next[key] = cachedBranchMap[key];
  }
  next[repoKey] = entry;

  const nextKeys = Object.keys(next);
  for (const key of nextKeys.slice(
    0,
    Math.max(0, nextKeys.length - MAX_CACHED_BRANCH_REPOS),
  )) {
    delete next[key];
  }
  return next;
}

export interface EffectiveBranches {
  effectiveBranches: FlattenedBranches;
  servingFromCache: boolean;
}

/**
 * Picks the branch list the selector should render: the cached entry stands in
 * only while the live query has produced nothing yet (loading or errored) and
 * no search is active, so the selector shows the last-known-good list instead
 * of a loading state.
 */
export function resolveEffectiveBranches({
  liveLoading,
  liveErrored,
  searchActive,
  liveBranches,
  cachedBranches,
}: {
  liveLoading: boolean;
  liveErrored: boolean;
  searchActive: boolean;
  liveBranches: FlattenedBranches | null;
  cachedBranches: CachedRepoBranches | undefined;
}): EffectiveBranches {
  if (liveBranches) {
    return { effectiveBranches: liveBranches, servingFromCache: false };
  }
  const servingFromCache =
    !searchActive &&
    (liveLoading || liveErrored) &&
    !isEmptyCachedBranches(cachedBranches);
  if (servingFromCache && cachedBranches) {
    return {
      effectiveBranches: {
        branches: cachedBranches.branches,
        defaultBranch: cachedBranches.defaultBranch,
      },
      servingFromCache: true,
    };
  }
  return {
    effectiveBranches: { branches: [], defaultBranch: null },
    servingFromCache: false,
  };
}

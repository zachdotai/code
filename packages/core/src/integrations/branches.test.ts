import { describe, expect, it } from "vitest";
import {
  BRANCHES_FIRST_PAGE_SIZE,
  BRANCHES_PAGE_SIZE,
  type BranchCacheUpdateInputs,
  branchPageSizeForOffset,
  type CachedCloudBranchMap,
  computeNextBranchOffset,
  flattenBranchPages,
  type GithubBranchesPage,
  MAX_CACHED_BRANCH_REPOS,
  resolveBranchCacheUpdate,
  resolveEffectiveBranches,
} from "./branches";

const page = (
  branches: string[],
  hasMore: boolean,
  defaultBranch: string | null = null,
): GithubBranchesPage => ({ branches, hasMore, defaultBranch });

describe("branchPageSizeForOffset", () => {
  it("uses the first-page size for offset 0", () => {
    expect(branchPageSizeForOffset(0)).toBe(BRANCHES_FIRST_PAGE_SIZE);
    expect(branchPageSizeForOffset(50)).toBe(BRANCHES_PAGE_SIZE);
  });
});

describe("computeNextBranchOffset", () => {
  it("returns undefined when the last page has no more", () => {
    expect(
      computeNextBranchOffset(page(["a"], false), [page(["a"], false)]),
    ).toBe(undefined);
  });

  it("sums branch counts across pages for the next offset", () => {
    const pages = [page(["a", "b"], true), page(["c"], true)];
    expect(computeNextBranchOffset(pages[1], pages)).toBe(3);
  });
});

describe("flattenBranchPages", () => {
  it("returns empty defaults when there are no pages", () => {
    expect(flattenBranchPages(undefined)).toEqual({
      branches: [],
      defaultBranch: null,
    });
  });

  it("flattens branches and pulls defaultBranch from the first page", () => {
    const pages = [page(["a", "b"], true, "main"), page(["c"], false, "dev")];
    expect(flattenBranchPages(pages)).toEqual({
      branches: ["a", "b", "c"],
      defaultBranch: "main",
    });
  });
});

function cacheUpdateInputs(
  overrides: Partial<BranchCacheUpdateInputs> = {},
): BranchCacheUpdateInputs {
  return {
    repoKey: "a/x",
    searchActive: false,
    livePending: false,
    liveErrored: false,
    liveBranches: { branches: ["main", "dev"], defaultBranch: "main" },
    cachedBranchMap: {},
    ...overrides,
  };
}

describe("resolveBranchCacheUpdate", () => {
  it.each([
    ["no repo key", { repoKey: null }],
    ["a search is active", { searchActive: true }],
    ["the live query is pending", { livePending: true }],
    ["the live query errored", { liveErrored: true }],
    ["there is no live data", { liveBranches: null }],
  ] as Array<[string, Partial<BranchCacheUpdateInputs>]>)(
    "skips when %s",
    (_name, overrides) => {
      expect(resolveBranchCacheUpdate(cacheUpdateInputs(overrides))).toBeNull();
    },
  );

  it("writes a settled first page, capped to the first-page size", () => {
    const branches = Array.from({ length: 80 }, (_, i) => `branch-${i}`);
    const next = resolveBranchCacheUpdate(
      cacheUpdateInputs({
        liveBranches: { branches, defaultBranch: "main" },
      }),
    );
    expect(next).toEqual({
      "a/x": {
        branches: branches.slice(0, BRANCHES_FIRST_PAGE_SIZE),
        defaultBranch: "main",
      },
    });
  });

  it("skips when the entry is unchanged and already most recent", () => {
    const cachedBranchMap: CachedCloudBranchMap = {
      "a/y": { branches: ["main"], defaultBranch: "main" },
      "a/x": { branches: ["main", "dev"], defaultBranch: "main" },
    };
    expect(
      resolveBranchCacheUpdate(cacheUpdateInputs({ cachedBranchMap })),
    ).toBeNull();
  });

  it("moves an unchanged entry to most recent when it is not already", () => {
    const cachedBranchMap: CachedCloudBranchMap = {
      "a/x": { branches: ["main", "dev"], defaultBranch: "main" },
      "a/y": { branches: ["main"], defaultBranch: "main" },
    };
    const next = resolveBranchCacheUpdate(
      cacheUpdateInputs({ cachedBranchMap }),
    );
    expect(next).not.toBeNull();
    expect(Object.keys(next ?? {})).toEqual(["a/y", "a/x"]);
  });

  it("evicts the least recently written repos beyond the cap", () => {
    const cachedBranchMap: CachedCloudBranchMap = {};
    for (let i = 0; i < MAX_CACHED_BRANCH_REPOS; i++) {
      cachedBranchMap[`a/repo-${i}`] = {
        branches: ["main"],
        defaultBranch: "main",
      };
    }
    const next = resolveBranchCacheUpdate(
      cacheUpdateInputs({ cachedBranchMap }),
    );
    expect(Object.keys(next ?? {})).toHaveLength(MAX_CACHED_BRANCH_REPOS);
    expect(next?.["a/repo-0"]).toBeUndefined();
    expect(Object.keys(next ?? {}).at(-1)).toBe("a/x");
  });

  it("removes the entry when a clean fetch returns no branches", () => {
    const cachedBranchMap: CachedCloudBranchMap = {
      "a/x": { branches: ["main"], defaultBranch: "main" },
      "a/y": { branches: ["main"], defaultBranch: "main" },
    };
    const next = resolveBranchCacheUpdate(
      cacheUpdateInputs({
        liveBranches: { branches: [], defaultBranch: null },
        cachedBranchMap,
      }),
    );
    expect(next).toEqual({
      "a/y": { branches: ["main"], defaultBranch: "main" },
    });
  });

  it("skips when a clean empty fetch has no cached entry to remove", () => {
    expect(
      resolveBranchCacheUpdate(
        cacheUpdateInputs({
          liveBranches: { branches: [], defaultBranch: null },
        }),
      ),
    ).toBeNull();
  });
});

describe("resolveEffectiveBranches", () => {
  const cached = { branches: ["cached-main"], defaultBranch: "cached-main" };
  const live = { branches: ["main"], defaultBranch: "main" };

  it("prefers live data even when a cache exists", () => {
    const result = resolveEffectiveBranches({
      liveLoading: false,
      liveErrored: false,
      searchActive: false,
      liveBranches: live,
      cachedBranches: cached,
    });
    expect(result.servingFromCache).toBe(false);
    expect(result.effectiveBranches).toBe(live);
  });

  it.each([
    ["loading", { liveLoading: true, liveErrored: false }],
    ["errored", { liveLoading: false, liveErrored: true }],
  ])(
    "serves the cache while the live query is %s with no data",
    (_name, flags) => {
      const result = resolveEffectiveBranches({
        ...flags,
        searchActive: false,
        liveBranches: null,
        cachedBranches: cached,
      });
      expect(result.servingFromCache).toBe(true);
      expect(result.effectiveBranches).toEqual(cached);
    },
  );

  it("does not serve the cache while a search is active", () => {
    const result = resolveEffectiveBranches({
      liveLoading: true,
      liveErrored: false,
      searchActive: true,
      liveBranches: null,
      cachedBranches: cached,
    });
    expect(result.servingFromCache).toBe(false);
    expect(result.effectiveBranches).toEqual({
      branches: [],
      defaultBranch: null,
    });
  });

  it("does not serve an empty cached entry", () => {
    const result = resolveEffectiveBranches({
      liveLoading: true,
      liveErrored: false,
      searchActive: false,
      liveBranches: null,
      cachedBranches: { branches: [], defaultBranch: null },
    });
    expect(result.servingFromCache).toBe(false);
  });

  it("returns empty defaults when neither source has data", () => {
    const result = resolveEffectiveBranches({
      liveLoading: true,
      liveErrored: false,
      searchActive: false,
      liveBranches: null,
      cachedBranches: undefined,
    });
    expect(result.servingFromCache).toBe(false);
    expect(result.effectiveBranches).toEqual({
      branches: [],
      defaultBranch: null,
    });
  });
});

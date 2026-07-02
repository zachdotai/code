import { Clock, Context, Effect, Layer, Ref, Result, Schema } from "effect";
import { githubReleasesApiResponse, type ListReleasesOutput } from "./schemas";

const RELEASES_URL =
  "https://api.github.com/repos/PostHog/code/releases?per_page=30";
const CACHE_TTL_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;

export class GitHubReleasesError extends Schema.TaggedErrorClass<GitHubReleasesError>()(
  "GitHubReleasesError",
  { cause: Schema.Defect() },
) {}

interface CachedReleases {
  readonly fetchedAt: number;
  readonly data: ListReleasesOutput;
}

const fetchReleases = Effect.fn("GitHubReleases.fetch")(function* () {
  const response = yield* Effect.tryPromise({
    try: () =>
      fetch(RELEASES_URL, {
        headers: { Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }),
    catch: (cause) => new GitHubReleasesError({ cause }),
  });

  if (!response.ok) {
    return yield* Effect.fail(
      new GitHubReleasesError({
        cause: new Error(`GitHub releases fetch failed: ${response.status}`),
      }),
    );
  }

  const json = yield* Effect.tryPromise({
    try: () => response.json(),
    catch: (cause) => new GitHubReleasesError({ cause }),
  });
  const parsed = yield* Effect.try({
    try: () => githubReleasesApiResponse.parse(json),
    catch: (cause) => new GitHubReleasesError({ cause }),
  });

  const releases = parsed
    .filter((release) => !release.draft)
    .map((release) => ({
      version: release.tag_name.replace(/^v/, ""),
      name:
        release.name && release.name.length > 0
          ? release.name
          : release.tag_name,
      notes: release.body ?? "",
      date: release.published_at,
      isPrerelease: release.prerelease,
      htmlUrl: release.html_url,
    }));

  return { releases } satisfies ListReleasesOutput;
});

type ReleasesCache = Ref.Ref<CachedReleases | null>;

const listReleases = Effect.fn("GitHubReleases.list")(function* (
  cache: ReleasesCache,
) {
  const now = yield* Clock.currentTimeMillis;
  const cached = yield* Ref.get(cache);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const result = yield* Effect.result(fetchReleases());
  if (Result.isSuccess(result)) {
    yield* Ref.set(cache, { fetchedAt: now, data: result.success });
    return result.success;
  }

  // The refresh failed: serve the last good copy if we have one, else fail.
  if (cached) {
    return cached.data;
  }
  return yield* Effect.fail(result.failure);
});

export class GitHubReleases extends Context.Service<GitHubReleases>()(
  "GitHubReleases",
  {
    make: Effect.gen(function* () {
      const cache = yield* Ref.make<CachedReleases | null>(null);
      return { list: () => listReleases(cache) };
    }),
  },
) {
  static Live = Layer.effect(this, this.make);
}

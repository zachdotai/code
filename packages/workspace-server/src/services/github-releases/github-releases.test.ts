import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "@effect/vitest";
import { Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import { GitHubReleases } from "./github-releases";

const sampleReleases = [
  {
    tag_name: "v1.2.0",
    name: "v1.2.0",
    body: "## Notes\n- thing",
    draft: false,
    prerelease: false,
    published_at: "2026-06-20T00:00:00Z",
    html_url: "https://github.com/PostHog/code/releases/tag/v1.2.0",
  },
  {
    tag_name: "v1.1.0",
    name: "",
    body: null,
    draft: false,
    prerelease: true,
    published_at: "2026-06-10T00:00:00Z",
    html_url: "https://github.com/PostHog/code/releases/tag/v1.1.0",
  },
  {
    tag_name: "v1.3.0-draft",
    name: "draft",
    body: "x",
    draft: true,
    prerelease: false,
    published_at: null,
    html_url: "https://github.com/PostHog/code/releases/tag/v1.3.0-draft",
  },
];

const okResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => okResponse(sampleReleases));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHubReleases", () => {
  it.effect("maps releases, strips the v prefix and drops drafts", () =>
    Effect.gen(function* () {
      const { list } = yield* GitHubReleases;
      const { releases } = yield* list();

      expect(releases).toHaveLength(2);
      expect(releases[0]).toEqual({
        version: "1.2.0",
        name: "v1.2.0",
        notes: "## Notes\n- thing",
        date: "2026-06-20T00:00:00Z",
        isPrerelease: false,
        htmlUrl: "https://github.com/PostHog/code/releases/tag/v1.2.0",
      });
      // empty name falls back to the tag; null body becomes an empty string
      expect(releases[1]).toMatchObject({
        version: "1.1.0",
        name: "v1.1.0",
        notes: "",
        isPrerelease: true,
      });
    }).pipe(Effect.provide(GitHubReleases.Live)),
  );

  it.effect("caches results within the TTL", () =>
    Effect.gen(function* () {
      const { list } = yield* GitHubReleases;
      yield* list();
      yield* list();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }).pipe(Effect.provide(GitHubReleases.Live)),
  );

  it.effect("fails on a non-ok response when there is no cache", () =>
    Effect.gen(function* () {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
      const { list } = yield* GitHubReleases;
      const error = yield* Effect.flip(list());
      expect(error._tag).toBe("GitHubReleasesError");
    }).pipe(Effect.provide(GitHubReleases.Live)),
  );

  it.effect("serves stale cache when a later refetch fails", () =>
    Effect.gen(function* () {
      const { list } = yield* GitHubReleases;
      const first = yield* list();

      yield* TestClock.adjust(Duration.millis(11 * 60_000));
      fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
      const second = yield* list();

      expect(second).toEqual(first);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }).pipe(Effect.provide(GitHubReleases.Live)),
  );
});

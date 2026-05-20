import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    scope: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

import type { AuthService } from "../auth/service";
import { AffinityRouterService } from "./affinity-router";
import type { NestService } from "./nest-service";
import type { Nest } from "./schemas";

function makeNest(overrides: Partial<Nest> = {}): Nest {
  const now = "2026-05-13T00:00:00.000Z";
  return {
    id: crypto.randomUUID(),
    name: "Checkout lift",
    goalPrompt: "Improve checkout conversion",
    definitionOfDone: null,
    mapX: 0,
    mapY: 0,
    status: "active",
    health: "ok",
    targetMetricId: null,
    loadoutJson: "{}",
    primaryRepository: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

interface MockAuthOptions {
  apiHost?: string;
  mockUserMe?: Response;
  mockQuery?: Response;
}

function createMockAuth(options: MockAuthOptions = {}) {
  const calls: FetchCall[] = [];
  const apiHost = options.apiHost ?? "https://us.example";
  const userMeResp =
    options.mockUserMe ??
    new Response(JSON.stringify({ team: { id: 7 } }), { status: 200 });
  const queryResp =
    options.mockQuery ??
    new Response(JSON.stringify({ results: [] }), { status: 200 });

  const authenticatedFetch = vi.fn(
    async (_fetch: unknown, url: string | Request, init: RequestInit = {}) => {
      const urlString = typeof url === "string" ? url : url.url;
      calls.push({ url: urlString, init });
      if (urlString.includes("/api/users/@me/")) {
        return userMeResp.clone();
      }
      if (urlString.includes("/query/")) {
        return queryResp.clone();
      }
      return new Response("", { status: 404 });
    },
  );

  const auth = {
    getValidAccessToken: vi.fn(async () => ({
      accessToken: "token",
      apiHost,
    })),
    authenticatedFetch,
  } as unknown as AuthService;

  return { auth, calls };
}

function createMockNests(nests: Nest[] = []) {
  const list = vi.fn(() => nests);
  return {
    nests: { list } as unknown as NestService,
    list,
  };
}

describe("AffinityRouterService", () => {
  beforeEach(() => {
    delete process.env.HEDGEMONY_AFFINITY_THRESHOLD;
  });

  it("returns null when there are no active nests", async () => {
    const { auth } = createMockAuth();
    const { nests } = createMockNests([]);
    const router = new AffinityRouterService(auth, nests);
    const result = await router.route({ signalReportId: "sr-1" });
    expect(result).toBeNull();
    expect(auth.getValidAccessToken).not.toHaveBeenCalled();
  });

  it("skips nests that are not active", async () => {
    const archived = makeNest({ status: "archived" });
    const dormant = makeNest({ status: "dormant" });
    const { auth } = createMockAuth();
    const { nests } = createMockNests([archived, dormant]);
    const router = new AffinityRouterService(auth, nests);
    const result = await router.route({ signalReportId: "sr-1" });
    expect(result).toBeNull();
  });

  it("returns a match when similarity exceeds the threshold", async () => {
    const nest = makeNest({
      id: "nest-checkout",
      goalPrompt: "Improve checkout conversion",
    });
    const { auth } = createMockAuth({
      mockQuery: new Response(
        JSON.stringify({ results: [["nest-checkout", 0.1]] }),
        { status: 200 },
      ),
    });
    const { nests } = createMockNests([nest]);
    const router = new AffinityRouterService(auth, nests);
    const result = await router.route({ signalReportId: "sr-1" });
    expect(result).toEqual({
      nestId: "nest-checkout",
      score: expect.closeTo(0.9, 5),
    });
  });

  it("returns null when the best match is below threshold", async () => {
    const nest = makeNest({ id: "nest-1" });
    const { auth } = createMockAuth({
      mockQuery: new Response(JSON.stringify({ results: [["nest-1", 0.7]] }), {
        status: 200,
      }),
    });
    const { nests } = createMockNests([nest]);
    const router = new AffinityRouterService(auth, nests);
    const result = await router.route({ signalReportId: "sr-1" });
    expect(result).toBeNull();
  });

  it("respects the HEDGEMONY_AFFINITY_THRESHOLD env override", async () => {
    process.env.HEDGEMONY_AFFINITY_THRESHOLD = "0.95";
    const nest = makeNest({ id: "nest-1" });
    const { auth } = createMockAuth({
      mockQuery: new Response(JSON.stringify({ results: [["nest-1", 0.2]] }), {
        status: 200,
      }),
    });
    const { nests } = createMockNests([nest]);
    const router = new AffinityRouterService(auth, nests);
    // similarity = 0.8, threshold = 0.95 → below
    const result = await router.route({ signalReportId: "sr-1" });
    expect(result).toBeNull();
  });

  it("returns null on HTTP failure for the query call", async () => {
    const nest = makeNest({ id: "nest-1" });
    const { auth } = createMockAuth({
      mockQuery: new Response("oops", { status: 500 }),
    });
    const { nests } = createMockNests([nest]);
    const router = new AffinityRouterService(auth, nests);
    const result = await router.route({ signalReportId: "sr-1" });
    expect(result).toBeNull();
  });

  it("returns null and swallows when authenticatedFetch throws", async () => {
    const nest = makeNest({ id: "nest-1" });
    const { auth } = createMockAuth();
    (auth.authenticatedFetch as unknown as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockRejectedValue(new Error("network"));
    const { nests } = createMockNests([nest]);
    const router = new AffinityRouterService(auth, nests);
    const result = await router.route({ signalReportId: "sr-1" });
    expect(result).toBeNull();
  });

  it("caches the team id across calls", async () => {
    const nest = makeNest({ id: "nest-1" });
    const { auth, calls } = createMockAuth({
      mockQuery: new Response(JSON.stringify({ results: [["nest-1", 0.1]] }), {
        status: 200,
      }),
    });
    const { nests } = createMockNests([nest]);
    const router = new AffinityRouterService(auth, nests);
    await router.route({ signalReportId: "sr-1" });
    await router.route({ signalReportId: "sr-2" });

    const userMeCalls = calls.filter((c) => c.url.includes("/api/users/@me/"));
    expect(userMeCalls).toHaveLength(1);
  });

  it("returns null when query results are empty", async () => {
    const nest = makeNest({ id: "nest-1" });
    const { auth } = createMockAuth({
      mockQuery: new Response(JSON.stringify({ results: [] }), { status: 200 }),
    });
    const { nests } = createMockNests([nest]);
    const router = new AffinityRouterService(auth, nests);
    const result = await router.route({ signalReportId: "sr-1" });
    expect(result).toBeNull();
  });

  it("returns null when /api/users/@me/ has no team id", async () => {
    const nest = makeNest({ id: "nest-1" });
    const { auth } = createMockAuth({
      mockUserMe: new Response(JSON.stringify({ team: null }), { status: 200 }),
    });
    const { nests } = createMockNests([nest]);
    const router = new AffinityRouterService(auth, nests);
    const result = await router.route({ signalReportId: "sr-1" });
    expect(result).toBeNull();
  });
});

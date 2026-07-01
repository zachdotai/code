import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignalsClient } from "./index";

type MockResult = { status?: number; body: unknown };
type Handler = (url: URL, init: RequestInit) => MockResult;

interface RecordedCall {
  url: URL;
  init: RequestInit;
}

function mockFetch(handler: Handler): RecordedCall[] {
  const calls: RecordedCall[] = [];
  const fn = vi.fn(async (input: URL | string, init: RequestInit = {}) => {
    const url = input instanceof URL ? input : new URL(String(input));
    calls.push({ url, init });
    const { status = 200, body } = handler(url, init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

function authHeader(init: RequestInit): string | null {
  return new Headers(init.headers).get("Authorization");
}

function last(calls: RecordedCall[]): RecordedCall {
  const call = calls.at(-1);
  if (!call) throw new Error("no fetch calls recorded");
  return call;
}

const BASE = {
  apiHost: "https://us.posthog.com",
  personalApiKey: "phx_test",
  projectId: 7,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("inbox", () => {
  it("lists reports with query params and a Bearer token", async () => {
    const calls = mockFetch(() => ({
      body: { results: [{ id: "r1" }], count: 1 },
    }));
    const client = createSignalsClient(BASE);

    const res = await client.inbox.list({ status: "ready", limit: 10 });

    expect(res.count).toBe(1);
    const call = last(calls);
    expect(call.url.pathname).toBe("/api/projects/7/signals/reports/");
    expect(call.url.searchParams.get("status")).toBe("ready");
    expect(call.url.searchParams.get("limit")).toBe("10");
    expect(authHeader(call.init)).toBe("Bearer phx_test");
  });

  it("snooze posts a potential state with snooze_for", async () => {
    const calls = mockFetch(() => ({
      body: { id: "r1", status: "potential" },
    }));
    const client = createSignalsClient(BASE);

    await client.inbox.snooze("r1", 3600);

    const call = last(calls);
    expect(call.url.pathname).toBe("/api/projects/7/signals/reports/r1/state/");
    expect(call.init.method).toBe("POST");
    expect(JSON.parse(String(call.init.body))).toEqual({
      state: "potential",
      snooze_for: 3600,
    });
  });

  it("suppress posts a suppressed state with a dismissal reason", async () => {
    const calls = mockFetch(() => ({
      body: { id: "r1", status: "suppressed" },
    }));
    const client = createSignalsClient(BASE);

    await client.inbox.suppress("r1", {
      reason: "already_fixed",
      note: "dupe",
    });

    const call = last(calls);
    expect(call.url.pathname).toBe("/api/projects/7/signals/reports/r1/state/");
    expect(JSON.parse(String(call.init.body))).toEqual({
      state: "suppressed",
      dismissal_reason: "already_fixed",
      dismissal_note: "dupe",
    });
  });
});

describe("scouts", () => {
  it("lists configs under the resolved project id", async () => {
    const calls = mockFetch(() => ({ body: { results: [{ id: "c1" }] } }));
    const client = createSignalsClient(BASE);

    await client.scouts.listConfigs();

    expect(last(calls).url.pathname).toBe(
      "/api/projects/7/signals/scout/configs/",
    );
  });

  it("toggle maps runIntervalMinutes to run_interval_minutes via PATCH", async () => {
    const calls = mockFetch(() => ({ body: { id: "c1", enabled: true } }));
    const client = createSignalsClient(BASE);

    await client.scouts.toggle("c1", {
      enabled: true,
      runIntervalMinutes: 120,
    });

    const call = last(calls);
    expect(call.url.pathname).toBe("/api/projects/7/signals/scout/configs/c1/");
    expect(call.init.method).toBe("PATCH");
    expect(JSON.parse(String(call.init.body))).toEqual({
      enabled: true,
      run_interval_minutes: 120,
    });
  });
});

describe("responders", () => {
  it("toggle patches a source config's enabled flag", async () => {
    const calls = mockFetch(() => ({ body: { id: "s1", enabled: false } }));
    const client = createSignalsClient(BASE);

    await client.responders.toggle("s1", false);

    const call = last(calls);
    expect(call.url.pathname).toBe(
      "/api/projects/7/signals/source_configs/s1/",
    );
    expect(call.init.method).toBe("PATCH");
    expect(JSON.parse(String(call.init.body))).toEqual({ enabled: false });
  });
});

describe("project id resolution", () => {
  it("resolves the project id from /api/users/@me/ when not configured", async () => {
    const calls = mockFetch((url) => {
      if (url.pathname === "/api/users/@me/") {
        return { body: { team: { id: 42 } } };
      }
      return { body: [] };
    });
    const client = createSignalsClient({
      apiHost: "https://eu.posthog.com/",
      personalApiKey: "phx_x",
    });

    expect(await client.getProjectId()).toBe(42);

    await client.scouts.listConfigs();
    expect(last(calls).url.pathname).toBe(
      "/api/projects/42/signals/scout/configs/",
    );
    // Resolution is cached: only one call to /me/ across both operations.
    expect(
      calls.filter((c) => c.url.pathname === "/api/users/@me/"),
    ).toHaveLength(1);
  });
});

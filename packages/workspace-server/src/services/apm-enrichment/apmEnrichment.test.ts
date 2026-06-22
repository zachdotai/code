import type { RootLogger } from "@posthog/di/logger";
import { APM_STATS_WINDOW, type SymbolStatsRow } from "@posthog/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnrichmentAuth } from "../enrichment/ports";
import { ApmEnrichmentService } from "./apmEnrichment";

const noop = () => {};
const noopLogger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  scope: () => noopLogger,
} as unknown as RootLogger;

function authed(): EnrichmentAuth {
  return {
    getState: () => ({
      status: "authenticated",
      projectId: 2,
      cloudRegion: "us",
    }),
    getValidAccessToken: async () => ({
      accessToken: "tok",
      apiHost: "https://us.posthog.com",
    }),
  };
}

function unauthed(): EnrichmentAuth {
  return {
    getState: () => ({
      status: "unauthenticated",
      projectId: null,
      cloudRegion: null,
    }),
    getValidAccessToken: vi.fn(),
  };
}

// Authenticated state, but token resolution blows up (network error, corrupted
// token store) — exercises the catch in resolveApiConfig.
function tokenThrows(): EnrichmentAuth {
  return {
    getState: () => ({
      status: "authenticated",
      projectId: 2,
      cloudRegion: "us",
    }),
    getValidAccessToken: async () => {
      throw new Error("token store unavailable");
    },
  };
}

// A symbol-stats response row (line mode), typed against the wire shape so the
// fixture can't drift from the fields mapSymbolStatsResults reads.
function symbolRow(overrides: Partial<SymbolStatsRow> = {}): SymbolStatsRow {
  return {
    line: 459,
    count: 100,
    error_count: 0,
    sum_duration_nano: 0,
    p50_duration_nano: 2_000_000,
    p95_duration_nano: 7_000_000,
    p99_duration_nano: 0,
    busy_count: 0,
    p50_busy_nano: 0,
    p95_busy_nano: 0,
    p99_busy_nano: 0,
    count_pct_change: null,
    p50_duration_pct_change: null,
    p95_duration_pct_change: null,
    p99_duration_pct_change: null,
    error_rate_pct_change: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ApmEnrichmentService", () => {
  // Every row resolves to null; they differ only in what fails. Rows with no
  // fetchImpl must never reach the network — resolveApiConfig bails first.
  it.each([
    { name: "unauthenticated", auth: unauthed, fetchImpl: undefined },
    {
      name: "access-token resolution throws",
      auth: tokenThrows,
      fetchImpl: undefined,
    },
    {
      name: "the symbol-stats query responds with an error status",
      auth: authed,
      fetchImpl: async () => ({
        ok: false,
        status: 500,
        statusText: "Server Error",
        json: async () => ({}),
      }),
    },
  ])("returns null when $name", async ({ auth, fetchImpl }) => {
    const fetchMock = vi.fn(fetchImpl);
    vi.stubGlobal("fetch", fetchMock);

    const result = await new ApmEnrichmentService(
      auth(),
      noopLogger,
    ).enrichFile({ filePath: "rust/feature-flags/src/flags/flag_matching.rs" });

    expect(result).toBeNull();
    if (!fetchImpl) expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs a line-mode symbol-stats query for the file", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [symbolRow()], granularity: "line" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await new ApmEnrichmentService(authed(), noopLogger).enrichFile({
      filePath: "rust/feature-flags/src/flags/flag_matching.rs",
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://us.posthog.com/api/projects/2/tracing/spans/symbol-stats/",
    );
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok",
    );
    const body = JSON.parse(init.body as string);
    expect(body.query.kind).toBe("TraceSpansSymbolStatsQuery");
    expect(body.query.filePath).toBe(
      "rust/feature-flags/src/flags/flag_matching.rs",
    );
    expect(body.query.dateRange.date_from).toBe(APM_STATS_WINDOW.dateFrom);
    // Line mode — the editor gutter wants per-line stats, not per-symbol.
    expect(body.query.symbols).toBeUndefined();
  });

  it("maps symbol-stats rows to per-line stats for the file", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          symbolRow({ line: 459, count: 26, error_count: 0 }),
          symbolRow({
            line: 900,
            count: 30,
            error_count: 8,
            p95_duration_pct_change: 186,
          }),
        ],
        granularity: "line",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new ApmEnrichmentService(
      authed(),
      noopLogger,
    ).enrichFile({
      filePath: "rust/feature-flags/src/flags/flag_matching.rs",
    });

    expect(result?.filePath).toBe(
      "rust/feature-flags/src/flags/flag_matching.rs",
    );
    expect(result?.tracingUrl).toBe("https://us.posthog.com/project/2/tracing");
    expect(result?.stats).toHaveLength(2);
    // p50_duration_nano 2_000_000 → 2ms, p95 7_000_000 → 7ms (nsToMs).
    expect(result?.stats[0]).toMatchObject({
      line: 459,
      count: 26,
      p50Ms: 2,
      p95Ms: 7,
    });
    expect(result?.stats[1]).toMatchObject({
      line: 900,
      count: 30,
      errorCount: 8,
      p95PctChange: 186,
    });
  });
});

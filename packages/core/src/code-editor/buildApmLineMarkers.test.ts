import type { SerializedApmEnrichment, SpanLineStat } from "@posthog/shared";
import { describe, expect, it } from "vitest";
import { buildApmLineMarkers } from "./buildApmLineMarkers";

function stat(overrides: Partial<SpanLineStat>): SpanLineStat {
  return {
    line: 1,
    count: 10,
    errorCount: 0,
    p50Ms: 1,
    p95Ms: 2,
    ...overrides,
  };
}

function enrichment(stats: SpanLineStat[]): SerializedApmEnrichment {
  return { filePath: "x.rs", stats, tracingUrl: "https://us.posthog.com/x" };
}

describe("buildApmLineMarkers", () => {
  it("returns no markers for null enrichment", () => {
    expect(buildApmLineMarkers(null)).toEqual([]);
  });

  it("produces one marker per line stat", () => {
    const markers = buildApmLineMarkers(
      enrichment([
        stat({ line: 459, p95Ms: 4.8 }),
        stat({ line: 900, p95Ms: 1.3 }),
      ]),
    );
    expect(markers.map((m) => m.line)).toEqual([459, 900]);
  });

  it("carries the underlying stat through to each marker", () => {
    const [marker] = buildApmLineMarkers(
      enrichment([stat({ line: 42, p95Ms: 4, count: 7 })]),
    );
    expect(marker.stat).toMatchObject({ line: 42, p95Ms: 4, count: 7 });
  });

  it("summarizes p95/p50 latency and span count for the tooltip", () => {
    const [marker] = buildApmLineMarkers(
      enrichment([stat({ p95Ms: 4.8, p50Ms: 1.7, count: 1240 })]),
    );
    expect(marker.summary).toContain("p95 4.8");
    expect(marker.summary).toContain("1240 spans");
  });
});

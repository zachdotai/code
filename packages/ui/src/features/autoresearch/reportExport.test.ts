import type {
  AutoresearchIteration,
  AutoresearchRun,
} from "@posthog/core/autoresearch/schemas";
import { describe, expect, it } from "vitest";
import {
  buildReportBody,
  buildReportHtml,
  reportFileName,
} from "./reportExport";

const EXPORTED_AT = new Date("2026-07-07T12:00:00Z");

function makeIteration(
  overrides: Partial<AutoresearchIteration> = {},
): AutoresearchIteration {
  return {
    index: 1,
    value: 100,
    bestValue: 100,
    delta: null,
    summary: "Baseline",
    at: Date.UTC(2026, 6, 7, 10, 0),
    ...overrides,
  };
}

function makeRun(overrides: Partial<AutoresearchRun> = {}): AutoresearchRun {
  return {
    id: "run-1",
    config: {
      taskId: "task-1",
      direction: "minimize",
      targetValue: 80,
      maxIterations: 10,
      implementModel: null,
      measureModel: null,
      implementEffort: null,
      measureEffort: null,
      instructions: "Shrink the bundle without breaking tests.",
    },
    status: "completed",
    metricName: "bundle size",
    metricUnit: "kB",
    phase: null,
    originalModel: null,
    originalEffort: null,
    iterations: [
      makeIteration(),
      makeIteration({ index: 2, value: 90, bestValue: 90, delta: -10 }),
    ],
    startedAt: Date.UTC(2026, 6, 7, 9, 0),
    endedAt: Date.UTC(2026, 6, 7, 11, 0),
    endReason: "target-reached",
    interruptedReason: null,
    lastError: null,
    ...overrides,
  };
}

describe("buildReportBody", () => {
  it("includes the header, stats, chart, iterations, and brief", () => {
    const body = buildReportBody(makeRun(), EXPORTED_AT);
    expect(body).toContain("bundle size");
    expect(body).toContain("minimize");
    expect(body).toContain("Completed");
    expect(body).toContain("2 / 10");
    expect(body).toContain("<svg");
    expect(body).toContain("target 80 kB");
    expect(body).toContain("Baseline");
    expect(body).toContain("Shrink the bundle without breaking tests.");
  });

  it("marks the best iteration and colors deltas by direction", () => {
    const body = buildReportBody(makeRun(), EXPORTED_AT);
    expect(body).toContain(">best</span>");
    // -10 on a minimize run is an improvement.
    expect(body).toContain("-10 kB");
  });

  it("escapes agent-provided text", () => {
    const run = makeRun({
      metricName: `<img src=x onerror="x">`,
      iterations: [makeIteration({ summary: "<script>alert(1)</script>" })],
    });
    const body = buildReportBody(run, EXPORTED_AT);
    expect(body).not.toContain("<script>");
    expect(body).not.toContain("<img");
    expect(body).toContain("&lt;script&gt;");
  });

  it("renders without iterations or target", () => {
    const run = makeRun({
      iterations: [],
      config: { ...makeRun().config, targetValue: null },
      metricName: null,
      metricUnit: null,
    });
    const body = buildReportBody(run, EXPORTED_AT);
    expect(body).toContain("Autoresearch");
    expect(body).toContain("No iterations recorded.");
    expect(body).not.toContain("<svg");
  });
});

describe("buildReportHtml", () => {
  it("produces a self-contained document with no external references", () => {
    const html = buildReportHtml(makeRun(), EXPORTED_AT);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("<style>");
    // Nothing fetched at open time: no scripts, stylesheets, or images.
    expect(html).not.toMatch(/<(script|link|img)\b/);
    expect(html).not.toMatch(/\b(src|href)=/);
    expect(html).toContain("<title>bundle size — autoresearch report</title>");
  });
});

describe("reportFileName", () => {
  it.each([
    ["bundle size (kB)", "autoresearch-bundle-size-kb.html"],
    [null, "autoresearch-report.html"],
    ["///", "autoresearch-report.html"],
  ])("slugs %j", (metricName, expected) => {
    expect(reportFileName(makeRun({ metricName }), "html")).toBe(expected);
  });
});

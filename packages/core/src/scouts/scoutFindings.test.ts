import type {
  LinkedSignalReport,
  ScoutEmission,
  ScoutRun,
} from "@posthog/api-client/posthog-client";
import {
  availableScouts,
  buildFindingRows,
  emittedRunsKey,
  FINDINGS_SCOUT_FILTER_ALL,
  FINDINGS_SEVERITY_FILTER_ALL,
  filterAndSortFindings,
  latestEmittedAt,
  mostRecentEmittedRuns,
  reportsBySourceId,
  type ScoutFindingRow,
} from "@posthog/core/scouts/scoutFindings";
import { describe, expect, it } from "vitest";

function run(partial: Partial<ScoutRun> & Pick<ScoutRun, "run_id">): ScoutRun {
  return {
    skill_name: "signals-scout-error-tracking",
    skill_version: 1,
    status: "completed",
    started_at: "2026-06-29T10:00:00Z",
    completed_at: "2026-06-29T10:05:00Z",
    task_id: null,
    task_run_id: null,
    task_url: null,
    summary: "",
    emitted_count: 1,
    emitted_finding_ids: [],
    ...partial,
  };
}

function emission(
  partial: Partial<ScoutEmission> & Pick<ScoutEmission, "id" | "run_id">,
): ScoutEmission {
  return {
    finding_id: `finding-${partial.id}`,
    description: "Something happened",
    weight: 1,
    confidence: 0.5,
    severity: "P2",
    source_id: `run:${partial.run_id}:finding:${partial.id}`,
    emitted_at: "2026-06-29T10:01:00Z",
    ...partial,
  };
}

const report: LinkedSignalReport = {
  id: "report-1",
  title: "An incident",
  status: "ready",
};

describe("mostRecentEmittedRuns", () => {
  it("keeps only runs that emitted, newest-first by started_at", () => {
    const runs = [
      run({
        run_id: "a",
        started_at: "2026-06-29T08:00:00Z",
        emitted_count: 2,
      }),
      run({
        run_id: "b",
        started_at: "2026-06-29T09:00:00Z",
        emitted_count: 0,
      }),
      run({
        run_id: "c",
        started_at: "2026-06-29T10:00:00Z",
        emitted_count: 1,
      }),
    ];
    expect(mostRecentEmittedRuns(runs).map((r) => r.run_id)).toEqual([
      "c",
      "a",
    ]);
  });

  it("treats null emitted_count as quiet", () => {
    const runs = [run({ run_id: "a", emitted_count: null })];
    expect(mostRecentEmittedRuns(runs)).toEqual([]);
  });

  it("caps the run set", () => {
    const runs = Array.from({ length: 5 }, (_, i) =>
      run({ run_id: `r${i}`, started_at: `2026-06-29T1${i}:00:00Z` }),
    );
    expect(mostRecentEmittedRuns(runs, 2)).toHaveLength(2);
  });
});

describe("emittedRunsKey", () => {
  it("is order-independent and includes emitted_count", () => {
    const a = [
      run({ run_id: "x", emitted_count: 1 }),
      run({ run_id: "y", emitted_count: 2 }),
    ];
    const b = [
      run({ run_id: "y", emitted_count: 2 }),
      run({ run_id: "x", emitted_count: 1 }),
    ];
    expect(emittedRunsKey(a)).toBe(emittedRunsKey(b));
  });

  it("changes when a run emits more", () => {
    const before = emittedRunsKey([run({ run_id: "x", emitted_count: 1 })]);
    const after = emittedRunsKey([run({ run_id: "x", emitted_count: 2 })]);
    expect(before).not.toBe(after);
  });
});

describe("buildFindingRows", () => {
  it("joins emissions to their run and linked report", () => {
    const runs = [run({ run_id: "a" })];
    const emissions = [emission({ id: "1", run_id: "a", source_id: "src-1" })];
    const reportBySourceId = reportsBySourceId([
      { source_id: "src-1", report },
    ]);
    const rows = buildFindingRows(emissions, runs, reportBySourceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.run.run_id).toBe("a");
    expect(rows[0]?.report).toBe(report);
  });

  it("drops emissions whose run is absent", () => {
    const emissions = [emission({ id: "1", run_id: "gone" })];
    expect(
      buildFindingRows(emissions, [run({ run_id: "a" })], new Map()),
    ).toEqual([]);
  });

  it("leaves report null when unlinked", () => {
    const runs = [run({ run_id: "a" })];
    const emissions = [emission({ id: "1", run_id: "a", source_id: "src-1" })];
    expect(buildFindingRows(emissions, runs, new Map())[0]?.report).toBeNull();
  });
});

describe("reportsBySourceId", () => {
  it("indexes only links with a report", () => {
    const map = reportsBySourceId([
      { source_id: "src-1", report },
      { source_id: "src-2", report: null },
    ]);
    expect(map.get("src-1")).toBe(report);
    expect(map.has("src-2")).toBe(false);
  });
});

function rowsFrom(
  specs: {
    id: string;
    skill: string;
    severity: string | null;
    confidence: number;
    emittedAt: string;
    description?: string;
  }[],
): ScoutFindingRow[] {
  return specs.map((spec) => ({
    emission: emission({
      id: spec.id,
      run_id: spec.id,
      severity: spec.severity,
      confidence: spec.confidence,
      emitted_at: spec.emittedAt,
      description: spec.description ?? "x",
    }),
    run: run({ run_id: spec.id, skill_name: spec.skill }),
    report: null,
  }));
}

describe("availableScouts", () => {
  it("counts distinct scouts and labels them, sorted by label", () => {
    const rows = rowsFrom([
      {
        id: "1",
        skill: "signals-scout-web-analytics",
        severity: "P1",
        confidence: 0.5,
        emittedAt: "2026-06-29T10:00:00Z",
      },
      {
        id: "2",
        skill: "signals-scout-error-tracking",
        severity: "P1",
        confidence: 0.5,
        emittedAt: "2026-06-29T10:00:00Z",
      },
      {
        id: "3",
        skill: "signals-scout-error-tracking",
        severity: "P1",
        confidence: 0.5,
        emittedAt: "2026-06-29T10:00:00Z",
      },
    ]);
    const scouts = availableScouts(rows);
    expect(scouts.map((s) => s.skillName)).toEqual([
      "signals-scout-error-tracking",
      "signals-scout-web-analytics",
    ]);
    expect(scouts[0]?.count).toBe(2);
    expect(scouts[0]?.label).toBe("Error tracking");
  });
});

describe("filterAndSortFindings", () => {
  const base = {
    searchText: "",
    scoutFilter: FINDINGS_SCOUT_FILTER_ALL,
    severityFilter: FINDINGS_SEVERITY_FILTER_ALL,
    sortKey: "newest" as const,
  };
  const rows = rowsFrom([
    {
      id: "a",
      skill: "signals-scout-error-tracking",
      severity: "P0",
      confidence: 0.3,
      emittedAt: "2026-06-29T08:00:00Z",
      description: "database outage",
    },
    {
      id: "b",
      skill: "signals-scout-web-analytics",
      severity: "P3",
      confidence: 0.9,
      emittedAt: "2026-06-29T10:00:00Z",
      description: "traffic dip",
    },
    {
      id: "c",
      skill: "signals-scout-error-tracking",
      severity: "P2",
      confidence: 0.6,
      emittedAt: "2026-06-29T09:00:00Z",
      description: "slow query",
    },
  ]);

  it("sorts newest-first by default", () => {
    expect(filterAndSortFindings(rows, base).map((r) => r.emission.id)).toEqual(
      ["b", "c", "a"],
    );
  });

  it("sorts oldest-first", () => {
    expect(
      filterAndSortFindings(rows, { ...base, sortKey: "oldest" }).map(
        (r) => r.emission.id,
      ),
    ).toEqual(["a", "c", "b"]);
  });

  it("sorts by severity (most severe first)", () => {
    expect(
      filterAndSortFindings(rows, { ...base, sortKey: "severity" }).map(
        (r) => r.emission.id,
      ),
    ).toEqual(["a", "c", "b"]);
  });

  it("sorts by confidence (highest first)", () => {
    expect(
      filterAndSortFindings(rows, { ...base, sortKey: "confidence" }).map(
        (r) => r.emission.id,
      ),
    ).toEqual(["b", "c", "a"]);
  });

  it("filters by scout", () => {
    expect(
      filterAndSortFindings(rows, {
        ...base,
        scoutFilter: "signals-scout-web-analytics",
      }).map((r) => r.emission.id),
    ).toEqual(["b"]);
  });

  it("filters by severity", () => {
    expect(
      filterAndSortFindings(rows, { ...base, severityFilter: "P0" }).map(
        (r) => r.emission.id,
      ),
    ).toEqual(["a"]);
  });

  it("searches over description and prettified scout name", () => {
    expect(
      filterAndSortFindings(rows, { ...base, searchText: "outage" }).map(
        (r) => r.emission.id,
      ),
    ).toEqual(["a"]);
    // "Error tracking" is the prettified skill name for two rows.
    expect(
      filterAndSortFindings(rows, { ...base, searchText: "error tracking" })
        .map((r) => r.emission.id)
        .sort(),
    ).toEqual(["a", "c"]);
  });
});

describe("latestEmittedAt", () => {
  it("returns the max emitted_at", () => {
    const rows = rowsFrom([
      {
        id: "a",
        skill: "s",
        severity: "P1",
        confidence: 0.5,
        emittedAt: "2026-06-29T08:00:00Z",
      },
      {
        id: "b",
        skill: "s",
        severity: "P1",
        confidence: 0.5,
        emittedAt: "2026-06-29T10:00:00Z",
      },
    ]);
    expect(latestEmittedAt(rows)).toBe("2026-06-29T10:00:00Z");
  });

  it("returns null for no rows", () => {
    expect(latestEmittedAt([])).toBeNull();
  });
});

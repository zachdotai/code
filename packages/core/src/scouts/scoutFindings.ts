import type {
  LinkedSignalReport,
  ScoutEmission,
  ScoutRun,
} from "@posthog/api-client/posthog-client";
import { prettifyScoutSkillName } from "@posthog/core/scouts/scoutPresentation";

/**
 * Cross-fleet findings model — the pure counterpart of the per-scout
 * {@link ScoutSignalsSection} aggregation, shared by the findings page. Mirrors
 * the PostHog Cloud `findingsLogic` selectors so the two surfaces stay in
 * parity: flatten every recent emission into one row joined to its run (for the
 * emitting scout + task-run link) and the inbox report it grouped into, then
 * search / filter / sort over that flat list.
 */

/** A single finding paired with its run and the inbox report it fed into. */
export interface ScoutFindingRow {
  emission: ScoutEmission;
  run: ScoutRun;
  /** The inbox report this finding's signal grouped into, or null when unlinked. */
  report: LinkedSignalReport | null;
}

export type FindingsSortKey = "newest" | "oldest" | "severity" | "confidence";

export const FINDINGS_SCOUT_FILTER_ALL = "all";
export const FINDINGS_SEVERITY_FILTER_ALL = "all";

/** Severities the fleet emits, most severe first — drives the severity sort + filter options. */
export const FINDINGS_SEVERITIES = ["P0", "P1", "P2", "P3", "P4"] as const;

/**
 * Cap on the emitted runs whose findings the page fans out to fetch. A scout is
 * bounded to ~48 runs per 72h window by its 30-minute minimum cadence, but a
 * larger fleet multiplies that, so capping the run set caps the per-run
 * emissions-query fan-out the page mounts.
 */
export const FINDINGS_MAX_EMITTED_RUNS = 40;

/** Lowest number = most severe, so the severity sort is a plain ascending compare. Unknown sinks last. */
const SEVERITY_RANK: Record<string, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
  P4: 4,
};
function severityRank(severity: string | null): number {
  return severity == null ? 99 : (SEVERITY_RANK[severity] ?? 98);
}

/** Newest-first by the run's start time; runs without one sink last. */
function byRunStartedDesc(a: ScoutRun, b: ScoutRun): number {
  return (b.started_at ?? "").localeCompare(a.started_at ?? "");
}

/**
 * The emitted runs whose findings the page fetches: those that actually emitted,
 * newest-first, capped fleet-wide. Mirrors the Cloud `mostRecentEmittedRuns`
 * util so the page and any callout summary count the exact same run set.
 */
export function mostRecentEmittedRuns(
  runs: ScoutRun[],
  cap: number = FINDINGS_MAX_EMITTED_RUNS,
): ScoutRun[] {
  return runs
    .filter((run) => (run.emitted_count ?? 0) > 0)
    .slice()
    .sort(byRunStartedDesc)
    .slice(0, cap);
}

/**
 * Stable key over the emitted-run set — lets the page refetch only when the set
 * changes, not on every poll. Includes `emitted_count` so an in-progress run
 * that emits more findings retriggers.
 */
export function emittedRunsKey(runs: ScoutRun[]): string {
  return runs
    .map((run) => `${run.run_id}:${run.emitted_count ?? 0}`)
    .sort()
    .join(",");
}

/**
 * Join each emission back to its run and the report it grouped into. Emissions
 * whose run is absent from the set (e.g. evicted past the cap) are dropped.
 */
export function buildFindingRows(
  emissions: ScoutEmission[],
  runs: ScoutRun[],
  reportBySourceId: Map<string, LinkedSignalReport>,
): ScoutFindingRow[] {
  const runsById = new Map(runs.map((run) => [run.run_id, run]));
  return emissions
    .map((emission): ScoutFindingRow | null => {
      const run = runsById.get(emission.run_id);
      return run
        ? {
            emission,
            run,
            report: reportBySourceId.get(emission.source_id) ?? null,
          }
        : null;
    })
    .filter((row): row is ScoutFindingRow => row !== null);
}

/** A linked report indexed by its finding's `source_id`, for {@link buildFindingRows}. */
export function reportsBySourceId(
  links: { source_id: string; report: LinkedSignalReport | null }[],
): Map<string, LinkedSignalReport> {
  const map = new Map<string, LinkedSignalReport>();
  for (const link of links) {
    if (link.report) map.set(link.source_id, link.report);
  }
  return map;
}

export interface ScoutAvailableScout {
  skillName: string;
  label: string;
  count: number;
}

/** Distinct scouts present in the rows, with a per-scout count, for the scout filter. */
export function availableScouts(
  rows: ScoutFindingRow[],
): ScoutAvailableScout[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.run.skill_name, (counts.get(row.run.skill_name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([skillName, count]) => ({
      skillName,
      label: prettifyScoutSkillName(skillName),
      count,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export interface FindingsFilter {
  searchText: string;
  /** A `skill_name`, or {@link FINDINGS_SCOUT_FILTER_ALL}. */
  scoutFilter: string;
  /** A severity, or {@link FINDINGS_SEVERITY_FILTER_ALL}. */
  severityFilter: string;
  sortKey: FindingsSortKey;
}

function byEmittedDesc(a: ScoutFindingRow, b: ScoutFindingRow): number {
  return (b.emission.emitted_at ?? "").localeCompare(
    a.emission.emitted_at ?? "",
  );
}

/**
 * Visible set: search (over finding text + prettified scout name) + scout +
 * severity, then sort. Pure; the page wires it to its filter state.
 */
export function filterAndSortFindings(
  rows: ScoutFindingRow[],
  { searchText, scoutFilter, severityFilter, sortKey }: FindingsFilter,
): ScoutFindingRow[] {
  const needle = searchText.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (
      scoutFilter !== FINDINGS_SCOUT_FILTER_ALL &&
      row.run.skill_name !== scoutFilter
    ) {
      return false;
    }
    if (
      severityFilter !== FINDINGS_SEVERITY_FILTER_ALL &&
      row.emission.severity !== severityFilter
    ) {
      return false;
    }
    if (needle) {
      const haystack =
        `${row.emission.description ?? ""} ${prettifyScoutSkillName(row.run.skill_name)}`.toLowerCase();
      if (!haystack.includes(needle)) {
        return false;
      }
    }
    return true;
  });

  return filtered.slice().sort((a, b) => {
    if (sortKey === "oldest") {
      return -byEmittedDesc(a, b);
    }
    if (sortKey === "severity") {
      const diff =
        severityRank(a.emission.severity) - severityRank(b.emission.severity);
      return diff !== 0 ? diff : byEmittedDesc(a, b);
    }
    if (sortKey === "confidence") {
      const diff = (b.emission.confidence ?? 0) - (a.emission.confidence ?? 0);
      return diff !== 0 ? diff : byEmittedDesc(a, b);
    }
    return byEmittedDesc(a, b);
  });
}

/** Most recent `emitted_at` across the rows, for the page's "latest" hint. */
export function latestEmittedAt(rows: ScoutFindingRow[]): string | null {
  let latest: string | null = null;
  for (const row of rows) {
    const at = row.emission.emitted_at;
    if (at && (!latest || at > latest)) {
      latest = at;
    }
  }
  return latest;
}

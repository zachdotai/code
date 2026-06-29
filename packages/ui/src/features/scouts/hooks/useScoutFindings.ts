import type {
  ScoutEmission,
  ScoutEmissionReportLink,
} from "@posthog/api-client/posthog-client";
import {
  buildFindingRows,
  mostRecentEmittedRuns,
  reportsBySourceId,
  type ScoutFindingRow,
} from "@posthog/core/scouts/scoutFindings";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { AUTH_SCOPED_QUERY_META } from "@posthog/ui/features/auth/useCurrentUser";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { useAuthStateValue } from "../../auth/store";
import { scoutQueryKeys } from "./scoutQueryKeys";
import { useScoutRuns } from "./useScoutRuns";

export interface ScoutFindings {
  rows: ScoutFindingRow[];
  /** True until the runs window and its first emissions fan-out have resolved once. */
  isLoading: boolean;
  /** True when the runs window failed, or every emitted run's emissions fetch failed. */
  isError: boolean;
  /**
   * Emitted runs whose promised findings are missing from the list — the
   * emissions fetch either failed or resolved empty despite `emitted_count > 0`.
   * Non-zero means the visible list is an undercount.
   */
  incompleteRuns: number;
  /**
   * True when the recent-runs set the page covers is itself clipped — pagination
   * stopped early, or more emitted runs exist than the fan-out cap fetches. The
   * window's own findings may therefore be missing, beyond {@link incompleteRuns}.
   */
  windowTruncated: boolean;
  refetch: () => void;
}

/**
 * Cross-fleet findings — the data behind the findings page. Reads the polled
 * runs window, narrows it to the recent emitted runs, then fans out one
 * emissions query + one report-link query per run (emissions are only fetchable
 * per run), and flattens the lot into one row list via the core
 * {@link buildFindingRows}. The per-scout {@link ScoutSignalsSection} renders a
 * child component per run instead; a single sortable list can't, so the fan-out
 * lives here as `useQueries`.
 */
export function useScoutFindings(): ScoutFindings {
  const client = useOptionalAuthenticatedClient();
  const projectId = useAuthStateValue((state) => state.currentProjectId);
  const runsQuery = useScoutRuns();

  const allEmittedRuns = useMemo(
    () =>
      (runsQuery.data?.runs ?? []).filter(
        (run) => (run.emitted_count ?? 0) > 0,
      ),
    [runsQuery.data],
  );
  const emittedRuns = useMemo(
    () => mostRecentEmittedRuns(runsQuery.data?.runs ?? []),
    [runsQuery.data],
  );

  const emissionsResults = useQueries({
    queries: emittedRuns.map((run) => ({
      // emitted_count in the key so an in-progress run that emits more retriggers
      // its fetch; completed runs hold a stable count and never refetch. The
      // shared prefix stays intact for prefix-targeted invalidation.
      queryKey: [
        ...scoutQueryKeys.emissions(projectId, run.run_id),
        run.emitted_count ?? 0,
      ],
      queryFn: async (): Promise<ScoutEmission[]> => {
        if (!client) throw new Error("Not authenticated");
        if (!projectId) return [];
        return client.listScoutRunEmissions(projectId, run.run_id);
      },
      enabled: !!client && !!projectId,
      staleTime: 60_000,
      meta: AUTH_SCOPED_QUERY_META,
    })),
  });

  const reportResults = useQueries({
    queries: emittedRuns.map((run) => ({
      queryKey: scoutQueryKeys.emissionReports(projectId, run.run_id),
      queryFn: async (): Promise<ScoutEmissionReportLink[]> => {
        if (!client) throw new Error("Not authenticated");
        if (!projectId) return [];
        return client.listScoutEmissionReports(projectId, run.run_id);
      },
      enabled: !!client && !!projectId,
      staleTime: 60_000,
      meta: AUTH_SCOPED_QUERY_META,
    })),
  });

  const emissions = useMemo(
    () => emissionsResults.flatMap((result) => result.data ?? []),
    [emissionsResults],
  );
  const reportLinks = useMemo(
    () => reportResults.flatMap((result) => result.data ?? []),
    [reportResults],
  );

  const rows = useMemo(
    () =>
      buildFindingRows(emissions, emittedRuns, reportsBySourceId(reportLinks)),
    [emissions, emittedRuns, reportLinks],
  );

  // First load only — `isLoading` stays false across background polls so the
  // list doesn't flash a skeleton each refetch.
  const emissionsLoading = emissionsResults.some((result) => result.isLoading);
  const isLoading =
    runsQuery.isLoading ||
    (emittedRuns.length > 0 && emissionsLoading && emissions.length === 0);

  // Total failure: the window failed, or it loaded but every emitted run's
  // emissions fetch rejected (so there is nothing to show).
  const allEmissionsFailed =
    emittedRuns.length > 0 &&
    emissionsResults.every((result) => result.isError);
  const isError = runsQuery.isError || allEmissionsFailed;

  // Runs that promised findings (emitted_count > 0) but didn't deliver them:
  // the fetch errored, or it resolved empty (eventual-consistency lag, or a
  // backend quirk). Either way those findings are missing from the list, so
  // the page can warn rather than imply completeness. Only meaningful when it
  // isn't a total failure (that surfaces as `isError`).
  const incompleteRuns = allEmissionsFailed
    ? 0
    : emittedRuns.reduce((count, run, index) => {
        const result = emissionsResults[index];
        if (!result) return count;
        if (result.isError) return count + 1;
        const empty = (result.data?.length ?? 0) === 0;
        if (result.isSuccess && empty && (run.emitted_count ?? 0) > 0) {
          return count + 1;
        }
        return count;
      }, 0);

  // The run set itself is clipped when pagination stopped early, or when more
  // emitted runs exist than the fan-out cap fetches.
  const windowTruncated =
    !(runsQuery.data?.complete ?? true) ||
    allEmittedRuns.length > emittedRuns.length;

  return {
    rows,
    isLoading,
    isError,
    incompleteRuns,
    windowTruncated,
    refetch: () => {
      void runsQuery.refetch();
      for (const result of emissionsResults) void result.refetch();
      for (const result of reportResults) void result.refetch();
    },
  };
}

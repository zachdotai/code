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
  /** Emitted runs whose emissions fetch failed while others succeeded — the list is incomplete. */
  partialFailedRuns: number;
  /** False when the runs-window pagination stopped early, so the run set may be incomplete. */
  runsComplete: boolean;
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

  const emittedRuns = useMemo(
    () => mostRecentEmittedRuns(runsQuery.data?.runs ?? []),
    [runsQuery.data],
  );

  const emissionsResults = useQueries({
    queries: emittedRuns.map((run) => ({
      queryKey: scoutQueryKeys.emissions(projectId, run.run_id),
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

  // Partial failure only matters when some runs did load — a total failure is
  // reported as `isError` instead.
  const partialFailedRuns = allEmissionsFailed
    ? 0
    : emissionsResults.filter((result) => result.isError).length;

  return {
    rows,
    isLoading,
    isError,
    partialFailedRuns,
    runsComplete: runsQuery.data?.complete ?? true,
    refetch: () => {
      void runsQuery.refetch();
      for (const result of emissionsResults) void result.refetch();
      for (const result of reportResults) void result.refetch();
    },
  };
}

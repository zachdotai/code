import { getAuthenticatedClient } from "@features/auth/hooks/authClient";
import { useInboxReports } from "@features/inbox/hooks/useInboxReports";
import type { TaskService } from "@features/task-detail/service/service";
import { get as getFromContainer } from "@renderer/di/container";
import { RENDERER_TOKENS } from "@renderer/di/tokens";
import { trpcClient } from "@renderer/trpc/client";
import type { SignalReport } from "@shared/types";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import { track } from "@utils/analytics";
import { logger } from "@utils/logger";
import { useEffect, useRef } from "react";
import { useHogletStore } from "../stores/hogletStore";
import { buildSignalPrompt } from "../utils/signalPrompt";

const log = logger.scope("signal-ingestion");

/** Poll cadence for the Inbox signals endpoint. Slower than the Inbox tab's 3s
 *  cadence because staging is asynchronous — operators don't need sub-5s
 *  reaction. 30s keeps the network footprint modest while feeling live. */
const INGESTION_REFETCH_MS = 30_000;

/** Cap per-tick ingestion to avoid bursts when first opening the map view with
 *  a backlog. Remaining reports are picked up on the next refetch. */
const MAX_INGESTIONS_PER_TICK = 5;

// In dev, ingest reports still in research (in_progress) and candidate state
// alongside ready ones so the map can be exercised end-to-end without waiting
// for the full research pipeline to land a `ready` report. Production keeps
// the original filter so behaviour ships unchanged.
//
// Exported so consumers that need to look up the same cached report payload
// (e.g. SignalHogletCard) read from the exact key this hook writes to. If
// the two diverge, the card silently misses the cached report data.
export const SIGNAL_QUERY_PARAMS = {
  status: import.meta.env.DEV
    ? ("ready,in_progress,candidate" as const)
    : ("needs_review" as const),
  ordering: "-created_at" as const,
  limit: 50,
};

/**
 * Mounts a polling loop that mirrors net-new PostHog signal reports into
 * Hedgemony as signal-backed hoglets. Each new report becomes one cloud Task
 * (via the existing TaskCreationSaga) plus a `hedgemony_hoglet` sidecar row
 * keyed on `signal_report_id`. Dedupe is enforced by the UNIQUE index on the
 * sqlite side; this hook adds local fast-path skip checks to avoid wasted
 * round-trips for reports we've already ingested or are mid-flight on.
 *
 * Mount once inside the Hedgemony map view so the loop only runs while the
 * operator is looking at it. Unmounting tears down the underlying TanStack
 * query.
 */
export function useSignalIngestion(): void {
  const reportsQuery = useInboxReports(SIGNAL_QUERY_PARAMS, {
    refetchInterval: INGESTION_REFETCH_MS,
    staleTime: INGESTION_REFETCH_MS,
  });

  // Tracks reports currently mid-ingestion so a fast second refetch tick
  // doesn't double-spawn before the first round-trip lands. A successful
  // ingestion adds the row to `byBucket[WILD_BUCKET]` via the watch
  // subscription, which is then the durable source of truth.
  const inFlight = useRef<Set<string>>(new Set());

  useEffect(() => {
    const reports = reportsQuery.data?.results;
    if (!reports || reports.length === 0) return;
    void ingestNewReports(reports, inFlight.current);
  }, [reportsQuery.data]);
}

async function ingestNewReports(
  reports: ReadonlyArray<SignalReport>,
  inFlight: Set<string>,
): Promise<void> {
  // Signal-backed hoglets without a nest live in the wild bucket alongside
  // ad-hoc operator spawns. Auto-routed hoglets live inside their nest's
  // bucket. Walk every bucket so we don't re-ingest reports that already
  // have a hoglet anywhere in the system.
  const buckets = useHogletStore.getState().byBucket;
  const existingSignalIds = new Set<string>();
  for (const bucket of Object.values(buckets)) {
    for (const h of bucket) {
      if (h.signalReportId !== null) existingSignalIds.add(h.signalReportId);
    }
  }

  const candidates = reports.filter((r) => {
    if (existingSignalIds.has(r.id)) return false;
    if (inFlight.has(r.id)) return false;
    if (r.already_addressed === true) return false;
    if (r.implementation_pr_url) return false;
    return true;
  });

  if (candidates.length === 0) return;

  const batch = candidates.slice(0, MAX_INGESTIONS_PER_TICK);
  for (const report of batch) {
    inFlight.add(report.id);
    try {
      await ingestOne(report);
    } catch (error) {
      log.error("Failed to ingest signal report", {
        reportId: report.id,
        error,
      });
    } finally {
      inFlight.delete(report.id);
    }
  }
}

async function ingestOne(report: SignalReport): Promise<void> {
  const client = await getAuthenticatedClient();
  if (!client) {
    log.warn("Skipping signal ingestion: not authenticated", {
      reportId: report.id,
    });
    return;
  }

  const artefactsResp = await client.getSignalReportArtefacts(report.id);
  const prompt = buildSignalPrompt({
    report: { id: report.id, title: report.title, summary: report.summary },
    artefacts: artefactsResp.results,
  });

  const taskService = getFromContainer<TaskService>(
    RENDERER_TOKENS.TaskService,
  );
  const result = await taskService.createTask({
    content: prompt,
    workspaceMode: "cloud",
    cloudPrAuthorshipMode: "bot",
    cloudRunSource: "signal_report",
    signalReportId: report.id,
  });

  if (!result.success) {
    log.error("Task creation failed for signal report", {
      reportId: report.id,
      failedStep: result.failedStep,
      error: result.error,
    });
    return;
  }

  const taskId = result.data.task.id;
  try {
    await trpcClient.hedgemony.hoglets.recordSignalBacked.mutate({
      taskId,
      signalReportId: report.id,
    });
  } catch (error) {
    log.error("Failed to record signal-backed hoglet sidecar", {
      reportId: report.id,
      taskId,
      error,
    });
    return;
  }

  track(ANALYTICS_EVENTS.HEDGEMONY_HOGLET_INGESTED, { source: "signal" });
  log.info("Ingested signal report as hoglet", {
    reportId: report.id,
    taskId,
  });
}

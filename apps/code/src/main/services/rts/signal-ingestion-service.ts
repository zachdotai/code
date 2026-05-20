import { inject, injectable } from "inversify";
import type { SignalReport } from "../../../shared/types";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import type { CloudTaskClient } from "./cloud-task-client";
import type { HogletService } from "./hoglet-service";
import { buildSignalPrompt } from "./signal-prompt";
import { stringifyError } from "./utils";

const log = logger.scope("signal-ingestion-service");

/** Poll cadence for the cloud Inbox signals endpoint. Slower than the Inbox
 *  tab's 3s cadence because staging is asynchronous — operators don't need
 *  sub-5s reaction. */
const POLL_INTERVAL_MS = 30_000;

/** Cap per-tick ingestion so a freshly-opened map view with a backlog doesn't
 *  burst the cloud Task API. Remaining reports are picked up on the next tick. */
const MAX_INGESTIONS_PER_TICK = 5;

const REPORTS_QUERY_LIMIT = 50;

export const SignalIngestionEvent = {
  HogletIngested: "hogletIngested",
} as const;

export interface HogletIngestedEventPayload {
  signalReportId: string;
  taskId: string;
  hogletId: string;
}

export interface SignalIngestionEvents {
  [SignalIngestionEvent.HogletIngested]: HogletIngestedEventPayload;
}

interface QueryParams {
  status: string;
  ordering: string;
  limit: number;
}

/**
 * Slice-of-Rts service that mirrors net-new PostHog signal reports
 * into Rts as signal-backed hoglets. Polls the cloud `signals/reports`
 * endpoint every {@link POLL_INTERVAL_MS} and, for each report not already
 * ingested, spawns a fresh cloud Task (via {@link HogletService.spawnSignalBacked})
 * which writes the local `hedgemony_hoglet` sidecar.
 *
 * Owned by main so the orchestration survives the renderer-side map view
 * being unmounted mid-flight. The renderer kicks the loop with `start()`
 * (idempotent) when it mounts the map; `cancel()` is exposed for explicit
 * operator override but the renderer doesn't call it on unmount.
 *
 * Dedupe is enforced by `hoglet_repository.findBySignalReportId` (UNIQUE
 * index in sqlite). An in-memory `inFlight` set guards against a second
 * poll tick double-spawning the same report before the first round-trip
 * returns.
 */
@injectable()
export class SignalIngestionService extends TypedEventEmitter<SignalIngestionEvents> {
  private started = false;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private pollingNow = false;
  private readonly inFlight = new Set<string>();

  constructor(
    @inject(MAIN_TOKENS.CloudTaskClient)
    private readonly cloudTasks: CloudTaskClient,
    @inject(MAIN_TOKENS.HogletService)
    private readonly hoglets: HogletService,
  ) {
    super();
  }

  /** Idempotent. Renderer calls this on map-view mount. */
  start(): void {
    if (this.started) return;
    this.started = true;
    void this.runPoll();
    this.pollHandle = setInterval(() => {
      this.runPoll().catch((error) =>
        log.error("signal ingestion poll failed", {
          error: stringifyError(error),
        }),
      );
    }, POLL_INTERVAL_MS);
    log.info("SignalIngestionService started");
  }

  /**
   * Explicit operator override — the renderer does NOT call this on unmount.
   * Useful for tests and for a future "pause ingestion" UI toggle.
   */
  cancel(): void {
    if (!this.started) return;
    this.started = false;
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    log.info("SignalIngestionService cancelled");
  }

  isRunning(): boolean {
    return this.started;
  }

  /**
   * Exposed for tests so a single poll cycle can be driven without timers.
   * In production the interval timer in {@link start} runs it.
   */
  async runPoll(): Promise<void> {
    if (this.pollingNow) return;
    this.pollingNow = true;
    try {
      const params = this.queryParams();
      let response: Awaited<ReturnType<CloudTaskClient["listSignalReports"]>>;
      try {
        response = await this.cloudTasks.listSignalReports(params);
      } catch (error) {
        log.warn("listSignalReports failed", {
          error: stringifyError(error),
        });
        return;
      }
      const reports = response.results ?? [];
      if (reports.length === 0) return;
      await this.ingestNewReports(reports);
    } finally {
      this.pollingNow = false;
    }
  }

  private async ingestNewReports(
    reports: ReadonlyArray<SignalReport>,
  ): Promise<void> {
    const candidates = reports.filter((r) => {
      if (this.inFlight.has(r.id)) return false;
      if (r.already_addressed === true) return false;
      if (r.implementation_pr_url) return false;
      return true;
    });
    if (candidates.length === 0) return;

    const batch = candidates.slice(0, MAX_INGESTIONS_PER_TICK);
    for (const report of batch) {
      this.inFlight.add(report.id);
      try {
        await this.ingestOne(report);
      } catch (error) {
        log.error("Failed to ingest signal report", {
          reportId: report.id,
          error: stringifyError(error),
        });
      } finally {
        this.inFlight.delete(report.id);
      }
    }
  }

  private async ingestOne(report: SignalReport): Promise<void> {
    const artefacts = await this.cloudTasks.getSignalReportArtefacts(report.id);
    const prompt = buildSignalPrompt({
      report: { id: report.id, title: report.title, summary: report.summary },
      artefacts: artefacts.results,
    });

    const hoglet = await this.hoglets.spawnSignalBacked({
      prompt,
      signalReportId: report.id,
      reportTitle: report.title,
    });

    this.emit(SignalIngestionEvent.HogletIngested, {
      signalReportId: report.id,
      taskId: hoglet.taskId,
      hogletId: hoglet.id,
    });
    log.info("Ingested signal report as hoglet", {
      reportId: report.id,
      taskId: hoglet.taskId,
      hogletId: hoglet.id,
    });
  }

  // In dev, ingest reports still in research (in_progress) and candidate
  // state alongside ready ones so the map can be exercised end-to-end
  // without waiting for the full research pipeline. Production keeps the
  // original filter so behaviour ships unchanged.
  private queryParams(): QueryParams {
    return {
      status:
        process.env.NODE_ENV === "development"
          ? "ready,in_progress,candidate"
          : "needs_review",
      ordering: "-created_at",
      limit: REPORTS_QUERY_LIMIT,
    };
  }
}

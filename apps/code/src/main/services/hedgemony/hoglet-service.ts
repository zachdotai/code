import { inject, injectable } from "inversify";
import type { HogletRepository } from "../../db/repositories/hoglet-repository";
import type { PrDependencyRepository } from "../../db/repositories/pr-dependency-repository";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import type { AffinityRouterService } from "./affinity-router";
import type { CloudTaskClient } from "./cloud-task-client";
import {
  type AdoptHogletInput,
  type DismissSignalHogletInput,
  HedgemonyEvent,
  type HedgemonyEvents,
  type Hoglet,
  type HogletBucket,
  type HogletWatchEvent,
  type ListHogletsInput,
  type RecordAdhocHogletInput,
  type RecordSignalBackedHogletInput,
  type ReleaseHogletInput,
  type SpawnFollowUpHogletInput,
} from "./schemas";

const log = logger.scope("hoglet-service");

/** Safety caps from notes/hedgemony/backend-integration.md. */
export const MAX_WILD_HOGLETS = 25;
export const MAX_SIGNAL_STAGING_HOGLETS = 25;

function bucketForHoglet(h: Hoglet): HogletBucket {
  if (h.nestId !== null) return { kind: "nest", nestId: h.nestId };
  if (h.signalReportId !== null) return { kind: "signal_staging" };
  return { kind: "wild" };
}

/**
 * Owns the `hedgemony_hoglet` sidecar invariant. Hoglet creation is anchored
 * on cloud Task creation (driven by the renderer's TaskCreationSaga); this
 * service writes only the local sidecar row + emits an event. Chat/audit
 * is intentionally not coupled here — observers narrate creation later.
 */
@injectable()
export class HogletService extends TypedEventEmitter<HedgemonyEvents> {
  constructor(
    @inject(MAIN_TOKENS.HogletRepository)
    private readonly hoglets: HogletRepository,
    @inject(MAIN_TOKENS.AffinityRouterService)
    private readonly affinityRouter: AffinityRouterService,
    @inject(MAIN_TOKENS.PrDependencyRepository)
    private readonly prDependencies: PrDependencyRepository,
    @inject(MAIN_TOKENS.CloudTaskClient)
    private readonly cloudTasks: CloudTaskClient,
  ) {
    super();
  }

  list(input: ListHogletsInput): Hoglet[] {
    if (input.wildOnly) return this.hoglets.findAllWild();
    if (input.signalStagingOnly) return this.hoglets.findAllSignalStaging();
    if (input.nestId) return this.hoglets.findAllForNest(input.nestId);
    throw new Error(
      "hoglets.list requires wildOnly, signalStagingOnly, or nestId",
    );
  }

  recordAdhoc(input: RecordAdhocHogletInput): Hoglet {
    const existing = this.hoglets.findByTaskId(input.taskId);
    if (existing) {
      log.warn("Adhoc hoglet already exists for taskId", {
        taskId: input.taskId,
        hogletId: existing.id,
      });
      return existing;
    }

    const wildCount = this.hoglets.countWild();
    if (wildCount >= MAX_WILD_HOGLETS) {
      throw new Error("wild_hoglet_cap_reached");
    }

    const created = this.hoglets.create({
      taskId: input.taskId,
      nestId: null,
      signalReportId: null,
    });
    log.info("Adhoc hoglet recorded", {
      id: created.id,
      taskId: created.taskId,
    });
    this.emitChange({ kind: "wild" }, { kind: "upsert", hoglet: created });
    return created;
  }

  async recordSignalBacked(
    input: RecordSignalBackedHogletInput,
  ): Promise<Hoglet> {
    // Idempotent on signal_report_id (UNIQUE index in sqlite). A duplicate
    // ingestion attempt for the same signal returns the existing row.
    const existingBySignal = this.hoglets.findBySignalReportId(
      input.signalReportId,
    );
    if (existingBySignal) {
      log.warn("Signal-backed hoglet already exists for signalReportId", {
        signalReportId: input.signalReportId,
        hogletId: existingBySignal.id,
      });
      return existingBySignal;
    }
    // Guard against a race where the same task_id was already recorded by a
    // different pathway (shouldn't happen, but the UNIQUE constraint would
    // throw at insert and we'd rather return a clear error).
    const existingByTask = this.hoglets.findByTaskId(input.taskId);
    if (existingByTask) {
      log.warn("Hoglet already exists for taskId (signal ingestion)", {
        taskId: input.taskId,
        hogletId: existingByTask.id,
      });
      return existingByTask;
    }

    // Affinity routing: ask before insert so the hoglet lands in its final
    // home in one write. Failures inside the router return null without
    // throwing, so ingestion never fails because routing was unavailable.
    const match = await this.affinityRouter.route({
      signalReportId: input.signalReportId,
    });

    if (match === null) {
      const stagingCount = this.hoglets.countSignalStaging();
      if (stagingCount >= MAX_SIGNAL_STAGING_HOGLETS) {
        throw new Error("signal_staging_cap_reached");
      }
      const created = this.hoglets.create({
        taskId: input.taskId,
        nestId: null,
        signalReportId: input.signalReportId,
        affinityScore: null,
      });
      log.info("Signal-backed hoglet recorded in staging", {
        id: created.id,
        taskId: created.taskId,
        signalReportId: created.signalReportId,
      });
      this.emitChange(
        { kind: "signal_staging" },
        { kind: "upsert", hoglet: created },
      );
      return created;
    }

    const created = this.hoglets.create({
      taskId: input.taskId,
      nestId: match.nestId,
      signalReportId: input.signalReportId,
      affinityScore: match.score,
    });
    log.info("Signal-backed hoglet auto-routed to nest", {
      id: created.id,
      taskId: created.taskId,
      signalReportId: created.signalReportId,
      nestId: match.nestId,
      affinityScore: match.score,
    });
    this.emitChange(
      { kind: "nest", nestId: match.nestId },
      { kind: "upsert", hoglet: created },
    );
    return created;
  }

  adopt(input: AdoptHogletInput): Hoglet {
    const existing = this.hoglets.findById(input.hogletId);
    if (!existing) throw new Error("hoglet_not_found");
    if (existing.deletedAt) throw new Error("hoglet_deleted");
    if (existing.nestId === input.nestId) return existing;
    if (existing.nestId !== null) {
      // Slice-3 scope: nest→nest direct transfer is deferred. Future slices
      // add PR dependency edges and hedgehog scratchpad state that would need
      // explicit migration; operator must release first.
      throw new Error("hoglet_already_adopted");
    }

    const previousBucket = bucketForHoglet(existing);
    // Operator override clears the affinity score — the hoglet is now in its
    // current nest by operator decision, not by the router.
    const updated = this.hoglets.update(input.hogletId, {
      nestId: input.nestId,
      affinityScore: null,
    });
    if (!updated) throw new Error("hoglet_update_failed");

    this.emitChange(previousBucket, {
      kind: "removed",
      hogletId: updated.id,
    });
    this.emitChange(
      { kind: "nest", nestId: input.nestId },
      { kind: "upsert", hoglet: updated },
    );
    log.info("Hoglet adopted", {
      id: updated.id,
      nestId: updated.nestId,
      from: previousBucket.kind,
    });
    return updated;
  }

  release(input: ReleaseHogletInput): Hoglet {
    const existing = this.hoglets.findById(input.hogletId);
    if (!existing) throw new Error("hoglet_not_found");
    if (existing.deletedAt) throw new Error("hoglet_deleted");
    if (existing.nestId === null) return existing;

    const previousNestId = existing.nestId;
    const updated = this.hoglets.update(input.hogletId, {
      nestId: null,
      affinityScore: null,
    });
    if (!updated) throw new Error("hoglet_update_failed");

    // Released signal-backed hoglets return to the signal-staging bucket;
    // ad-hoc hoglets return to wild. The destination bucket is determined by
    // whether signal_report_id is set, not by user choice.
    const destinationBucket = bucketForHoglet(updated);
    this.emitChange(
      { kind: "nest", nestId: previousNestId },
      { kind: "removed", hogletId: updated.id },
    );
    this.emitChange(destinationBucket, {
      kind: "upsert",
      hoglet: updated,
    });
    log.info("Hoglet released", {
      id: updated.id,
      fromNest: previousNestId,
      to: destinationBucket.kind,
    });
    return updated;
  }

  /**
   * Soft-deletes a signal-backed hoglet from the staging area. The caller
   * (renderer) is responsible for the upstream "suppress" call to the Inbox
   * signals API; this service intentionally doesn't reach across that
   * boundary. Audit log capture for the underlying signal happens via the
   * Inbox lifecycle, not Hedgemony.
   */
  dismissSignal(input: DismissSignalHogletInput): void {
    const existing = this.hoglets.findById(input.hogletId);
    if (!existing) throw new Error("hoglet_not_found");
    if (existing.signalReportId === null) {
      throw new Error("hoglet_not_signal_backed");
    }
    if (existing.deletedAt) {
      log.warn("dismissSignal called on already-deleted hoglet", {
        hogletId: existing.id,
      });
      return;
    }

    const bucket = bucketForHoglet(existing);
    const deleted = this.hoglets.softDelete(input.hogletId);
    if (!deleted) throw new Error("hoglet_update_failed");

    this.emitChange(bucket, { kind: "removed", hogletId: deleted.id });
    log.info("Signal-backed hoglet dismissed", {
      id: deleted.id,
      signalReportId: existing.signalReportId,
    });
  }

  /**
   * Spawns a follow-up hoglet in `nestId` to address late feedback on a
   * merged/closed parent's PR. Inherits the parent Task's repository so the
   * new agent operates in the same code context. Writes a
   * `hedgemony_pr_dependency` edge with `state = "follow_up"` linking the
   * new child Task to the parent, so the hedgehog and PR-graph UIs track
   * them together.
   */
  async spawnFollowUp(input: SpawnFollowUpHogletInput): Promise<Hoglet> {
    const parent = await this.cloudTasks.getTaskWithLatestRun(
      input.parentTaskId,
    );
    const childTask = await this.cloudTasks.createTask({
      title: `Follow-up: ${parent.task.title}`,
      description: input.prompt,
      repository: parent.task.repository ?? null,
      originProduct: "user_created",
      githubIntegration: parent.task.github_integration ?? null,
      githubUserIntegration: parent.task.github_user_integration ?? null,
    });

    const created = this.hoglets.create({
      taskId: childTask.id,
      nestId: input.nestId,
      signalReportId: null,
    });

    this.prDependencies.insert({
      nestId: input.nestId,
      parentTaskId: input.parentTaskId,
      childTaskId: childTask.id,
      state: "follow_up",
    });

    log.info("Follow-up hoglet spawned", {
      id: created.id,
      taskId: created.taskId,
      nestId: input.nestId,
      parentTaskId: input.parentTaskId,
      payloadRef: input.payloadRef,
    });

    this.emitChange(
      { kind: "nest", nestId: input.nestId },
      { kind: "upsert", hoglet: created },
    );
    return created;
  }

  private emitChange(bucket: HogletBucket, event: HogletWatchEvent): void {
    this.emit(HedgemonyEvent.HogletChanged, { bucket, event });
  }
}

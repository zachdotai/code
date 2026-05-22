import { Saga, type SagaLogger } from "@posthog/shared";
import { inject, injectable } from "inversify";
import type { Task, TaskRun } from "../../../shared/types";
import type { HogletRepository } from "../../db/repositories/rts/hoglet-repository";
import type { NestRepository } from "../../db/repositories/rts/nest-repository";
import type { PrDependencyRepository } from "../../db/repositories/rts/pr-dependency-repository";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import type { WorkspaceService } from "../workspace/service";
import type { AffinityRouterService } from "./affinity-router";
import type { CloudTaskClient } from "./cloud-task-client";
import { HOGLET_NAMES } from "./hoglet-names";
import {
  readUserTaskPreferences,
  resolveHogletRuntime,
} from "./hoglet-runtime-preferences";
import type { PrGraphService } from "./pr-graph-service";
import {
  type AdoptHogletInput,
  type DismissSignalHogletInput,
  type Hoglet,
  type HogletBucket,
  type HogletWatchEvent,
  type ListHogletsInput,
  type NestLoadout,
  type RecordAdhocHogletInput,
  type RecordSignalBackedHogletInput,
  type ReleaseHogletInput,
  type RetireHogletInput,
  RtsEvent,
  type RtsEvents,
  type SpawnFollowUpHogletInput,
  type SpawnHogletInNestInput,
} from "./schemas";

const log = logger.scope("hoglet-service");

/** Safety caps from notes/rts/backend-integration.md. The wild cap
 *  covers both operator-spawned ad-hoc hoglets and signal-backed hoglets that
 *  the affinity router didn't auto-route into a nest, since both share the
 *  wild bucket on the map. */
export const MAX_WILD_HOGLETS = 50;
export const MAX_NEST_HOGLETS = 10;

type CreateTaskInput = Parameters<CloudTaskClient["createTask"]>[0];
type CreateTaskRunInput = Parameters<CloudTaskClient["createTaskRun"]>[1];

interface HogletSpawnSagaInput<TOutput> {
  task: CreateTaskInput;
  run: CreateTaskRunInput;
  prompt: string;
  ensureCloudWorkspace: (
    taskId: string,
    branch: string | null | undefined,
  ) => Promise<void>;
  createLocalSidecar: (context: {
    task: Task;
    run: TaskRun;
  }) => Promise<TOutput> | TOutput;
  rollbackLocalSidecar: (output: TOutput) => Promise<void> | void;
}

interface SpawnInNestSagaOutput {
  hoglet: Hoglet;
  taskRunId: string;
  task: Task;
}

interface SpawnFollowUpSagaOutput {
  hoglet: Hoglet;
  taskRunId: string;
}

class HogletSpawnSaga<TOutput> extends Saga<
  HogletSpawnSagaInput<TOutput>,
  TOutput
> {
  readonly sagaName = "HogletSpawnSaga";

  constructor(
    private readonly cloudTasks: CloudTaskClient,
    logger?: SagaLogger,
  ) {
    super(logger);
  }

  protected async execute(
    input: HogletSpawnSagaInput<TOutput>,
  ): Promise<TOutput> {
    const task = await this.step({
      name: "create-cloud-task",
      execute: () => this.cloudTasks.createTask(input.task),
      rollback: (createdTask) => this.cloudTasks.deleteTask(createdTask.id),
    });

    const run = await this.step({
      name: "create-cloud-task-run",
      execute: () => this.cloudTasks.createTaskRun(task.id, input.run),
      rollback: async (createdRun) => {
        await this.cloudTasks.updateTaskRun(task.id, createdRun.id, {
          status: "cancelled",
          errorMessage: "Cancelled after Rts spawn failed",
        });
      },
    });

    await this.step({
      name: "ensure-cloud-workspace",
      execute: () => input.ensureCloudWorkspace(task.id, run.branch ?? null),
      rollback: async () => {},
    });

    await this.step({
      name: "start-cloud-task-run",
      execute: () =>
        this.cloudTasks.startTaskRun(task.id, run.id, {
          pendingUserMessage: input.prompt,
        }),
      rollback: async () => {
        await this.cloudTasks.updateTaskRun(task.id, run.id, {
          status: "cancelled",
          errorMessage: "Cancelled after Rts spawn failed",
        });
      },
    });

    return await this.step({
      name: "create-local-sidecar",
      execute: () => Promise.resolve(input.createLocalSidecar({ task, run })),
      rollback: (output) => Promise.resolve(input.rollbackLocalSidecar(output)),
    });
  }
}

function bucketForHoglet(h: Hoglet): HogletBucket {
  if (h.nestId !== null) return { kind: "nest", nestId: h.nestId };
  return { kind: "wild" };
}

/**
 * Owns the `rts_hoglet` sidecar invariant. Hoglet creation is anchored
 * on cloud Task creation (driven by the renderer's TaskCreationSaga); this
 * service writes only the local sidecar row + emits an event. Chat/audit
 * is intentionally not coupled here — observers narrate creation later.
 */
@injectable()
export class HogletService extends TypedEventEmitter<RtsEvents> {
  constructor(
    @inject(MAIN_TOKENS.HogletRepository)
    private readonly hoglets: HogletRepository,
    @inject(MAIN_TOKENS.AffinityRouterService)
    private readonly affinityRouter: AffinityRouterService,
    @inject(MAIN_TOKENS.PrDependencyRepository)
    private readonly prDependencies: PrDependencyRepository,
    @inject(MAIN_TOKENS.NestRepository)
    private readonly nests: NestRepository,
    @inject(MAIN_TOKENS.CloudTaskClient)
    private readonly cloudTasks: CloudTaskClient,
    @inject(MAIN_TOKENS.PrGraphService)
    private readonly prGraph: PrGraphService,
    @inject(MAIN_TOKENS.WorkspaceService)
    private readonly workspaceService: WorkspaceService,
  ) {
    super();
  }

  private assignName(): string | null {
    const usedNames = new Set(this.hoglets.findAllNames());
    const available = HOGLET_NAMES.filter(
      (n) => n !== "James" && !usedNames.has(n),
    );
    if (available.length === 0) return null;
    return available[Math.floor(Math.random() * available.length)];
  }

  private assertNestCapacity(nestId: string): void {
    const activeCount = this.hoglets.findAllForNest(nestId).length;
    if (activeCount >= MAX_NEST_HOGLETS) {
      throw new Error("nest_hoglet_cap_reached");
    }
  }

  list(input: ListHogletsInput): Hoglet[] {
    if (input.wildOnly) return this.hoglets.findAllWild();
    if (input.nestId) return this.hoglets.findAllForNest(input.nestId);
    throw new Error("hoglets.list requires wildOnly or nestId");
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
      name: this.assignName(),
      nestId: null,
      signalReportId: null,
    });
    log.info("Adhoc hoglet recorded", {
      id: created.id,
      name: created.name,
      taskId: created.taskId,
    });
    this.emitChange({ kind: "wild" }, { kind: "upsert", hoglet: created });
    return created;
  }

  /**
   * Spawns a brand-new cloud Task from a signal report's prompt, then writes
   * the local hoglet sidecar via {@link recordSignalBacked} (which handles
   * affinity routing into a nest or the wild bucket). Idempotent on
   * `signalReportId`: returns the existing hoglet without spawning a new
   * cloud task if one already exists.
   *
   * Owned by {@link SignalIngestionService}'s polling loop — operators don't
   * call this directly. Title is derived from the report (truncated to 120
   * chars), description carries the full prompt. The cloud task is tagged
   * with `origin_product=signal_report` so the upstream API records the link.
   */
  async spawnSignalBacked(input: {
    prompt: string;
    signalReportId: string;
    reportTitle: string | null;
  }): Promise<Hoglet> {
    const existing = this.hoglets.findBySignalReportId(input.signalReportId);
    if (existing) {
      log.info("spawnSignalBacked skipped — hoglet already exists", {
        signalReportId: input.signalReportId,
        hogletId: existing.id,
      });
      return existing;
    }

    const runtime = resolveHogletRuntime({}, readUserTaskPreferences());
    const title = (
      input.reportTitle?.trim() || truncateTitle(input.prompt)
    ).slice(0, 255);

    let createdTaskId: string | null = null;
    try {
      const task = await this.cloudTasks.createTask({
        title,
        description: input.prompt,
        originProduct: "signal_report",
        signalReport: input.signalReportId,
        signalReportTaskRelationship: "implementation",
      });
      createdTaskId = task.id;
      const run = await this.cloudTasks.createTaskRun(task.id, {
        environment: runtime.environment,
        mode: "background",
        runtimeAdapter: runtime.runtimeAdapter,
        model: runtime.model,
        reasoningEffort: runtime.reasoningEffort,
        initialPermissionMode: runtime.executionMode,
        prAuthorshipMode: "bot",
        runSource: "signal_report",
        signalReportId: input.signalReportId,
      });
      await this.ensureCloudWorkspace(task.id, run.branch ?? null);
      await this.cloudTasks.startTaskRun(task.id, run.id, {
        pendingUserMessage: input.prompt,
      });
      return await this.recordSignalBacked({
        taskId: task.id,
        signalReportId: input.signalReportId,
      });
    } catch (error) {
      if (createdTaskId !== null) {
        // Best-effort cloud rollback so the signal report doesn't end up
        // permanently linked to an orphaned task on the API side.
        await this.cloudTasks.deleteTask(createdTaskId).catch((rollbackError) =>
          log.warn("spawnSignalBacked rollback (deleteTask) failed", {
            taskId: createdTaskId,
            signalReportId: input.signalReportId,
            error:
              rollbackError instanceof Error
                ? rollbackError.message
                : String(rollbackError),
          }),
        );
      }
      throw error;
    }
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
      // No affinity match — the hoglet joins the wild bucket on the map.
      // Wild now covers both operator-spawned ad-hoc work and unrouted
      // signal-backed hoglets; the cap is shared.
      const wildCount = this.hoglets.countWild();
      if (wildCount >= MAX_WILD_HOGLETS) {
        throw new Error("wild_hoglet_cap_reached");
      }
      const created = this.hoglets.create({
        taskId: input.taskId,
        name: this.assignName(),
        nestId: null,
        signalReportId: input.signalReportId,
        affinityScore: null,
      });
      log.info("Signal-backed hoglet recorded as wild", {
        id: created.id,
        name: created.name,
        taskId: created.taskId,
        signalReportId: created.signalReportId,
      });
      this.emitChange({ kind: "wild" }, { kind: "upsert", hoglet: created });
      return created;
    }

    this.assertNestCapacity(match.nestId);

    const created = this.hoglets.create({
      taskId: input.taskId,
      name: this.assignName(),
      nestId: match.nestId,
      signalReportId: input.signalReportId,
      affinityScore: match.score,
    });
    log.info("Signal-backed hoglet auto-routed to nest", {
      id: created.id,
      name: created.name,
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
    this.assertNestCapacity(input.nestId);

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

    // Every released hoglet returns to wild — both ad-hoc and signal-backed.
    // The signal-backed ones keep their signal_report_id so the robot sprite
    // still renders, but they share the same bucket as ad-hoc wild hoglets.
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
   * Soft-deletes a signal-backed hoglet currently in the wild bucket. The
   * caller (renderer) is responsible for the upstream "suppress" call to
   * the Inbox signals API; this service intentionally doesn't reach across
   * that boundary. Audit log capture for the underlying signal happens via
   * the Inbox lifecycle, not Rts.
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

    // Cascade: remove any PR-graph edges that reference this hoglet's task so
    // stale arrows don't linger on the map (Slice 8).
    this.prGraph.unlinkAllForTask(deleted.taskId);

    this.emitChange(bucket, { kind: "removed", hogletId: deleted.id });
    log.info("Signal-backed hoglet dismissed", {
      id: deleted.id,
      signalReportId: existing.signalReportId,
    });
  }

  /**
   * Soft-deletes any hoglet (wild, signal-backed staging, or nested) and
   * emits a `removed` event for whichever bucket it currently lives in.
   * Unlike [[dismissSignal]] this does not touch the upstream Inbox signal —
   * callers that want to suppress the source signal must do so themselves.
   */
  retire(input: RetireHogletInput): void {
    const existing = this.hoglets.findById(input.hogletId);
    if (!existing) throw new Error("hoglet_not_found");
    if (existing.deletedAt) {
      log.warn("retire called on already-deleted hoglet", {
        hogletId: existing.id,
      });
      return;
    }

    const bucket = bucketForHoglet(existing);
    const deleted = this.hoglets.softDelete(input.hogletId);
    if (!deleted) throw new Error("hoglet_update_failed");

    this.emitChange(bucket, { kind: "removed", hogletId: deleted.id });
    log.info("Hoglet retired", {
      id: deleted.id,
      from: bucket.kind,
    });
  }

  retireByTaskId(taskId: string): void {
    const existing = this.hoglets.findByTaskId(taskId);
    if (!existing || existing.deletedAt) return;
    this.retire({ hogletId: existing.id });
  }

  emitChanged(hoglet: Hoglet): void {
    this.emitChange(bucketForHoglet(hoglet), { kind: "upsert", hoglet });
  }

  /**
   * Spawns a new hoglet inside a nest. Creates a cloud Task, creates and
   * starts a TaskRun, then inserts the local sidecar row only after the
   * cloud side succeeds. This ordering prevents orphaned sidecar rows
   * when the cloud API is unavailable.
   */
  async spawnInNest(
    input: SpawnHogletInNestInput,
    loadout: NestLoadout = {},
  ): Promise<{ hoglet: Hoglet; taskRunId: string }> {
    this.assertNestCapacity(input.nestId);

    const runtime = resolveHogletRuntime(loadout, readUserTaskPreferences());

    const repository = input.repository ?? null;
    const githubUserIntegration = repository
      ? await this.cloudTasks.resolveGithubUserIntegration(repository)
      : null;

    const result = await new HogletSpawnSaga<SpawnInNestSagaOutput>(
      this.cloudTasks,
      log,
    ).run({
      task: {
        title: truncateTitle(input.prompt),
        description: input.prompt,
        repository,
        originProduct: "automation",
        githubUserIntegration,
      },
      run: {
        environment: runtime.environment,
        mode: "background",
        runtimeAdapter: runtime.runtimeAdapter,
        model: runtime.model,
        reasoningEffort: runtime.reasoningEffort,
        initialPermissionMode: runtime.executionMode,
        prAuthorshipMode: "bot",
      },
      prompt: input.prompt,
      ensureCloudWorkspace: (taskId, branch) =>
        this.ensureCloudWorkspace(taskId, branch),
      createLocalSidecar: ({ task, run }) => {
        const hoglet = this.hoglets.create({
          taskId: task.id,
          name: this.assignName(),
          nestId: input.nestId,
          signalReportId: null,
          model: runtime.model,
        });
        return { hoglet, taskRunId: run.id, task };
      },
      rollbackLocalSidecar: ({ hoglet }) => {
        this.hoglets.softDelete(hoglet.id);
      },
    });
    if (!result.success) throw new Error(result.error);

    const { hoglet: created, taskRunId, task } = result.data;

    log.info("Hoglet spawned in nest", {
      id: created.id,
      name: created.name,
      taskId: task.id,
      taskRunId,
      nestId: input.nestId,
      model: runtime.model,
      reasoningEffort: runtime.reasoningEffort,
      runtimeAdapter: runtime.runtimeAdapter,
      executionMode: runtime.executionMode,
      environment: runtime.environment,
    });

    this.emitChange(
      { kind: "nest", nestId: input.nestId },
      { kind: "upsert", hoglet: created },
    );
    return { hoglet: created, taskRunId };
  }

  async ensureCloudWorkspace(
    taskId: string,
    branch?: string | null,
  ): Promise<void> {
    await this.workspaceService.createWorkspace({
      taskId,
      mainRepoPath: "",
      folderId: "",
      folderPath: "",
      mode: "cloud",
      branch: branch ?? undefined,
    });
  }

  /**
   * Spawns a follow-up hoglet in `nestId` to address late feedback on a
   * merged/closed parent's PR. Prefers the nest's current repository so
   * corrected nest state beats any stale parent task fields. Writes a
   * `rts_pr_dependency` edge with `state = "follow_up"` linking the
   * new child Task to the parent, so the hedgehog and PR-graph UIs track
   * them together.
   */
  async spawnFollowUp(
    input: SpawnFollowUpHogletInput,
    loadout: NestLoadout = {},
  ): Promise<Hoglet> {
    this.assertNestCapacity(input.nestId);

    const parent = await this.cloudTasks.getTaskWithLatestRun(
      input.parentTaskId,
    );
    const nestPrimaryRepository =
      this.nests.findById(input.nestId)?.primaryRepository ?? null;
    const repository = nestPrimaryRepository ?? parent.task.repository ?? null;
    const githubUserIntegration = repository
      ? await this.cloudTasks.resolveGithubUserIntegration(repository)
      : null;

    const runtime = resolveHogletRuntime(loadout, readUserTaskPreferences());

    const result = await new HogletSpawnSaga<SpawnFollowUpSagaOutput>(
      this.cloudTasks,
      log,
    ).run({
      task: {
        title: `Follow-up: ${parent.task.title}`,
        description: input.prompt,
        repository,
        originProduct: "user_created",
        githubUserIntegration,
      },
      run: {
        environment: runtime.environment,
        mode: "background",
        runtimeAdapter: runtime.runtimeAdapter,
        model: runtime.model,
        reasoningEffort: runtime.reasoningEffort,
        initialPermissionMode: runtime.executionMode,
        prAuthorshipMode: "bot",
      },
      prompt: input.prompt,
      ensureCloudWorkspace: (taskId, branch) =>
        this.ensureCloudWorkspace(taskId, branch),
      createLocalSidecar: ({ task, run }) => {
        const hoglet = this.hoglets.create({
          taskId: task.id,
          name: this.assignName(),
          nestId: input.nestId,
          signalReportId: null,
          model: runtime.model,
        });
        try {
          this.prDependencies.insert({
            nestId: input.nestId,
            parentTaskId: input.parentTaskId,
            childTaskId: task.id,
            state: "follow_up",
          });
        } catch (error) {
          this.hoglets.softDelete(hoglet.id);
          throw error;
        }
        return { hoglet, taskRunId: run.id };
      },
      rollbackLocalSidecar: ({ hoglet }) => {
        this.hoglets.softDelete(hoglet.id);
      },
    });
    if (!result.success) throw new Error(result.error);

    const created = result.data.hoglet;

    log.info("Follow-up hoglet spawned", {
      id: created.id,
      taskId: created.taskId,
      taskRunId: result.data.taskRunId,
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
    this.emit(RtsEvent.HogletChanged, { bucket, event });
  }
}

function truncateTitle(prompt: string): string {
  const firstLine = prompt.split("\n")[0].trim();
  if (firstLine.length <= 120) return firstLine;
  return `${firstLine.slice(0, 117)}...`;
}

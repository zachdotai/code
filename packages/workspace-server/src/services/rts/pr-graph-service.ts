import { TypedEventEmitter } from "@posthog/shared";
import { inject, injectable } from "inversify";
import {
  HOGLET_REPOSITORY,
  PR_DEPENDENCY_REPOSITORY,
} from "../../db/identifiers";
import type { HogletRepository } from "../../db/repositories/rts/hoglet-repository";
import type {
  PrDependency,
  PrDependencyRepository,
} from "../../db/repositories/rts/pr-dependency-repository";
import { GIT_SERVICE } from "../../di/tokens";
import type { GitService } from "../git/service";
import type { CloudTaskClient } from "./cloud-task-client";
import {
  CLOUD_TASK_CLIENT,
  NEST_CHAT_SERVICE,
  NEST_SERVICE,
} from "./identifiers";
import { logger } from "./logger";
import type { NestChatService } from "./nest-chat-service";
import type { NestService } from "./nest-service";
import {
  buildRebaseFollowUpPrompt,
  buildRebasePrompt,
} from "./pr-graph-prompts";
import {
  type LinkPrDependencyInput,
  type PrGraphChangedEvent,
  type RebaseChildEventPayload,
  type RecordRebaseOutcomeInput,
  RtsEvent,
  type UnlinkPrDependencyInput,
} from "./schemas";
import { stringifyError } from "./utils";

const log = logger.scope("pr-graph-service");

const POLL_INTERVAL_MS = 60_000;
const PER_PARENT_DEBOUNCE_MS = 55_000;
const MAX_PARALLEL_POLLS = 4;
// Bound to keep the buffer from growing without limit if the rts UI is
// never opened. Oldest entries are dropped first — the next poll cycle will
// repopulate anything that's still relevant.
const MAX_PENDING_EVENTS = 100;

export const PrGraphServiceEvent = {
  RebaseChild: "rebaseChild",
} as const;

export interface PrGraphServiceEvents {
  [PrGraphServiceEvent.RebaseChild]: RebaseChildEventPayload;
  [RtsEvent.PrGraphChanged]: PrGraphChangedEvent;
}

interface RequestRebaseInput {
  edgeId: string;
  promptOverride?: string;
}

/**
 * Slice 8 of Rts — the PR-graph router. Polls each `pending` edge's
 * parent PR every {@link POLL_INTERVAL_MS}; when the parent PR is detected as
 * merged, builds a rebase prompt and emits a `rebaseChild` event. A renderer
 * hook routes each event into the child hoglet's live session (or spawns a
 * follow-up) and calls {@link recordRebaseOutcome} to commit the transition.
 *
 * Mirrors `FeedbackRoutingService` shape — same poll cadence, same
 * pending-queue fork when no renderer is attached, same audit-row pattern.
 */
@injectable()
export class PrGraphService extends TypedEventEmitter<PrGraphServiceEvents> {
  private started = false;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private readonly pending: RebaseChildEventPayload[] = [];
  private readonly lastPolledAt = new Map<string, number>();
  private readonly emittedRebaseEdgeIds = new Set<string>();
  private pollingNow = false;

  constructor(
    @inject(PR_DEPENDENCY_REPOSITORY)
    private readonly prDependencies: PrDependencyRepository,
    @inject(HOGLET_REPOSITORY)
    private readonly hoglets: HogletRepository,
    @inject(CLOUD_TASK_CLIENT)
    private readonly cloudTasks: CloudTaskClient,
    @inject(GIT_SERVICE)
    private readonly git: GitService,
    @inject(NEST_SERVICE)
    private readonly nests: NestService,
    @inject(NEST_CHAT_SERVICE)
    private readonly nestChat: NestChatService,
  ) {
    super();
  }

  /**
   * Returns every edge in the nest (any state). The renderer overlay reads
   * this once on mount and patches via `watch` afterwards.
   */
  listForNest(nestId: string): PrDependency[] {
    return this.prDependencies.listForNest(nestId);
  }

  /** Idempotent. Starts the 60s parent-PR poll. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.pollHandle = setInterval(() => {
      this.runPoll().catch((error) =>
        log.error("poll failed", { error: stringifyError(error) }),
      );
    }, POLL_INTERVAL_MS);
    log.info("PrGraphService started");
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    log.info("PrGraphService stopped");
  }

  /**
   * Drains the queue of events emitted before the renderer subscriber
   * attached. The renderer calls this once on mount; new events after that
   * come through the subscription channel.
   */
  consumePending(): RebaseChildEventPayload[] {
    return this.pending.splice(0, this.pending.length);
  }

  /**
   * Idempotent edge create. Emits a `PrGraphChanged` upsert when a new row
   * lands (suppressed on duplicate to avoid renderer thrash). Returns the
   * canonical edge — fresh or pre-existing.
   */
  link(input: LinkPrDependencyInput): PrDependency {
    const { inserted, row } = this.prDependencies.insertOrIgnore({
      nestId: input.nestId,
      parentTaskId: input.parentTaskId,
      childTaskId: input.childTaskId,
      state: "pending",
    });
    if (inserted) {
      this.emitGraphChange(row.nestId, { kind: "upsert", edge: row });
      log.info("Edge linked", {
        edgeId: row.id,
        nestId: row.nestId,
        parentTaskId: row.parentTaskId,
        childTaskId: row.childTaskId,
      });
    }
    return row;
  }

  /**
   * Removes an edge. No-op if the edge no longer exists. Emits a
   * `PrGraphChanged` removed event so the overlay clears the arrow.
   */
  unlink(input: UnlinkPrDependencyInput): void {
    const existing = this.prDependencies.findById(input.id);
    if (!existing) return;
    this.prDependencies.delete(input.id);
    this.emittedRebaseEdgeIds.delete(existing.id);
    this.emitGraphChange(existing.nestId, {
      kind: "removed",
      edgeId: existing.id,
    });
    log.info("Edge unlinked", { edgeId: existing.id });
  }

  /**
   * Removes every edge that references `taskId` as parent or child. Called by
   * `HogletService` when a hoglet is deleted so stale arrows disappear.
   */
  unlinkAllForTask(taskId: string): void {
    const edges = [
      ...this.prDependencies.findByParentTaskId(taskId),
      ...this.prDependencies.findByChildTaskId(taskId),
    ];
    for (const edge of edges) {
      this.prDependencies.delete(edge.id);
      this.emittedRebaseEdgeIds.delete(edge.id);
      this.emitGraphChange(edge.nestId, {
        kind: "removed",
        edgeId: edge.id,
      });
    }
    if (edges.length > 0) {
      log.info("Edges cleared for task", { taskId, count: edges.length });
    }
  }

  /**
   * Public so the hedgehog's `rebase_child` tool can ask the service to
   * proactively emit a `RebaseChild` event for a child hoglet — without
   * waiting for the parent-merge poll. Throws if no `pending` edge currently
   * targets the requested child task.
   */
  async requestRebase(input: RequestRebaseInput): Promise<void> {
    const edge = this.prDependencies.findById(input.edgeId);
    if (!edge) throw new Error("edge_not_found");
    await this.emitRebaseForEdge(edge, input.promptOverride);
  }

  /**
   * Writes the rebase outcome back to the edge and a `pr_graph_rebase_routed`
   * audit row to nest chat. Idempotent on the edge state — calling twice with
   * the same outcome just re-emits the graph-change event so a slow renderer
   * catches up.
   */
  recordRebaseOutcome(input: RecordRebaseOutcomeInput): PrDependency {
    const edge = this.prDependencies.findById(input.edgeId);
    if (!edge) throw new Error("edge_not_found");
    this.emittedRebaseEdgeIds.delete(edge.id);

    const nextState = outcomeToState(input.outcome);
    const updated =
      edge.state === nextState
        ? edge
        : this.prDependencies.updateState(edge.id, nextState);

    this.emitGraphChange(updated.nestId, { kind: "upsert", edge: updated });

    const summary = describeRebaseOutcome(input.outcome);
    const message = this.nestChat.recordHedgehogMessage({
      nestId: updated.nestId,
      kind: "audit",
      body: summary + (input.note ? ` — ${input.note}` : ""),
      visibility: "summary",
      sourceTaskId: updated.childTaskId,
      payloadJson: {
        type: "pr_graph_rebase_routed",
        edgeId: updated.id,
        outcome: input.outcome,
        parentTaskId: updated.parentTaskId,
        childTaskId: updated.childTaskId,
        note: input.note ?? null,
      },
    });
    this.nests.emitMessageAppended(message);
    return updated;
  }

  /**
   * Public so tests can drive a single poll cycle without timers. In
   * production, the interval timer in `start()` runs it.
   */
  async runPoll(): Promise<void> {
    if (this.pollingNow) return;
    this.pollingNow = true;
    try {
      const pending = this.prDependencies.findPending();
      if (pending.length === 0) return;

      const byParent = new Map<string, PrDependency[]>();
      for (const edge of pending) {
        const list = byParent.get(edge.parentTaskId) ?? [];
        list.push(edge);
        byParent.set(edge.parentTaskId, list);
      }

      const now = Date.now();
      const due: Array<[string, PrDependency[]]> = [];
      for (const [parentTaskId, edges] of byParent) {
        const last = this.lastPolledAt.get(parentTaskId) ?? 0;
        if (now - last >= PER_PARENT_DEBOUNCE_MS) {
          due.push([parentTaskId, edges]);
        }
      }

      for (let i = 0; i < due.length; i += MAX_PARALLEL_POLLS) {
        const batch = due.slice(i, i + MAX_PARALLEL_POLLS);
        await Promise.all(
          batch.map(([parentTaskId, edges]) =>
            this.pollParent(parentTaskId, edges).catch((error) =>
              log.warn("parent poll failed", {
                parentTaskId,
                error: stringifyError(error),
              }),
            ),
          ),
        );
      }
    } finally {
      this.pollingNow = false;
    }
  }

  private async pollParent(
    parentTaskId: string,
    edges: PrDependency[],
  ): Promise<void> {
    this.lastPolledAt.set(parentTaskId, Date.now());

    let prUrl: string | null = null;
    let parentBranch: string | null = null;
    try {
      const { task } = await this.cloudTasks.getTaskWithLatestRun(parentTaskId);
      const candidate = task.latest_run?.output?.pr_url;
      if (typeof candidate === "string" && candidate.length > 0) {
        prUrl = candidate;
      }
      const branchCandidate = task.latest_run?.branch;
      if (typeof branchCandidate === "string" && branchCandidate.length > 0) {
        parentBranch = branchCandidate;
      }
    } catch (error) {
      log.debug("cloud task fetch failed during pr-graph poll", {
        parentTaskId,
        error: stringifyError(error),
      });
      return;
    }
    if (!prUrl) return;

    const status = await this.git.getPrDetailsByUrl(prUrl);
    if (!status?.merged) return;

    for (const edge of edges) {
      await this.emitRebaseForEdge(edge, undefined, { prUrl, parentBranch });
    }
  }

  private async emitRebaseForEdge(
    edge: PrDependency,
    promptOverride: string | undefined,
    parentContext?: { prUrl: string; parentBranch: string | null },
  ): Promise<void> {
    if (this.emittedRebaseEdgeIds.has(edge.id)) return;

    let prUrl = parentContext?.prUrl ?? null;
    let parentBranch = parentContext?.parentBranch ?? null;
    if (!prUrl) {
      try {
        const { task } = await this.cloudTasks.getTaskWithLatestRun(
          edge.parentTaskId,
        );
        const candidate = task.latest_run?.output?.pr_url;
        if (typeof candidate === "string" && candidate.length > 0) {
          prUrl = candidate;
        }
        const branchCandidate = task.latest_run?.branch;
        if (typeof branchCandidate === "string" && branchCandidate.length > 0) {
          parentBranch = branchCandidate;
        }
      } catch (error) {
        log.warn("could not resolve parent pr_url for rebase emit", {
          parentTaskId: edge.parentTaskId,
          error: stringifyError(error),
        });
      }
    }
    if (!prUrl) return;

    const childHoglet = this.hoglets.findByTaskId(edge.childTaskId);
    if (!childHoglet) {
      log.warn("rebase emit skipped — child hoglet missing", {
        edgeId: edge.id,
        childTaskId: edge.childTaskId,
      });
      return;
    }

    const prompt = promptOverride ?? buildRebasePrompt(prUrl, parentBranch);
    const fallbackPrompt = buildRebaseFollowUpPrompt(prUrl, parentBranch);

    this.emittedRebaseEdgeIds.add(edge.id);
    this.emitRebase({
      edgeId: edge.id,
      nestId: edge.nestId,
      parentTaskId: edge.parentTaskId,
      childTaskId: edge.childTaskId,
      childHogletId: childHoglet.id,
      parentPrUrl: prUrl,
      parentBranch,
      prompt,
      fallbackPrompt,
    });
  }

  private emitRebase(payload: RebaseChildEventPayload): void {
    const hasListeners =
      this.listenerCount(PrGraphServiceEvent.RebaseChild) > 0;
    if (hasListeners) {
      this.emit(PrGraphServiceEvent.RebaseChild, payload);
      return;
    }
    this.pending.push(payload);
    if (this.pending.length > MAX_PENDING_EVENTS) {
      const dropped = this.pending.shift();
      log.warn("pending rebaseChild queue full, dropped oldest", {
        cap: MAX_PENDING_EVENTS,
        droppedEdgeId: dropped?.edgeId,
      });
    }
  }

  private emitGraphChange(
    nestId: string,
    event: PrGraphChangedEvent["event"],
  ): void {
    this.emit(RtsEvent.PrGraphChanged, { nestId, event });
  }
}

function outcomeToState(
  outcome: RecordRebaseOutcomeInput["outcome"],
): "satisfied" | "broken" {
  switch (outcome) {
    case "injected":
    case "follow_up_spawned":
      return "satisfied";
    case "failed":
    case "broken":
      return "broken";
  }
}

function describeRebaseOutcome(
  outcome: RecordRebaseOutcomeInput["outcome"],
): string {
  switch (outcome) {
    case "injected":
      return "Routed rebase prompt → injected into live child session.";
    case "follow_up_spawned":
      return "Routed rebase → spawned a follow-up hoglet (no live child session).";
    case "failed":
      return "Routed rebase failed: no live session and no nest available.";
    case "broken":
      return "Rebase delivery broken — operator follow-up required.";
  }
}

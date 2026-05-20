import { parseGithubUrl } from "@posthog/git/utils";
import { inject, injectable } from "inversify";
import { normalizeRepoKey } from "../../../shared/utils/repo";
import type { FeedbackEventRepository } from "../../db/repositories/feedback-event-repository";
import type { HedgehogStateRepository } from "../../db/repositories/hedgehog-state-repository";
import type { OperatorDecisionRepository } from "../../db/repositories/operator-decision-repository";
import type { PrDependencyRepository } from "../../db/repositories/pr-dependency-repository";
import type { RepositoryRepository } from "../../db/repositories/repository-repository";
import type {
  TickLogRepository,
  TickOutcome,
} from "../../db/repositories/tick-log-repository";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import type { GitService } from "../git/service";
import type { PromptWithToolsOutput } from "../llm-gateway/schemas";
import type { LlmGatewayService } from "../llm-gateway/service";
import { getHedgemonyMaxTicksPerHour } from "../settingsStore";
import type { CloudTaskClient } from "./cloud-task-client";
import type { FeedbackRoutingService } from "./feedback-routing-service";
import { HEDGEHOG_HANDLERS } from "./hedgehog-handlers/registry";
import {
  type HandlerResult,
  type HedgehogToolDeps,
  TickBudget,
  type TickContext,
  type WriteNestMessageInput,
} from "./hedgehog-handlers/types";
import { stringifyError } from "./hedgehog-handlers/utils";
import {
  appendScratchpad,
  buildUserPrompt,
  deriveHogletLastOutput,
  HEDGEHOG_SYSTEM_PROMPT,
  HOGLET_OUTPUT_KINDS,
  type HogletPrState,
  type HogletWithState,
  type ScratchpadEntry,
} from "./hedgehog-prompts";
import { HEDGEHOG_TOOLS } from "./hedgehog-tools";
import {
  readUserTaskPreferences,
  resolveHogletRuntime,
} from "./hoglet-runtime-preferences";
import type { HogletService } from "./hoglet-service";
import type { NestChatService } from "./nest-chat-service";
import type { NestService } from "./nest-service";
import type { PrGraphService } from "./pr-graph-service";
import { parseHedgehogState, parseNestLoadout } from "./schema-parsers";
import {
  type ActiveHoldState,
  DEFAULT_HOGLET_MODEL,
  HedgemonyEvent,
  type Hoglet,
  type HogletChangedEvent,
  type Nest,
  type NestChangedEvent,
  type NestLoadout,
  type NestMessage,
  parseNestChatCreationBootstrapPayload,
} from "./schemas";
import type { UsageAttributionService } from "./usage-attribution-service";

const log = logger.scope("hedgehog-tick-service");

const MIN_TICK_INTERVAL_MS = 30_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 90_000;
const SCHEDULER_POLL_INTERVAL_MS = 60_000;
const HEDGEHOG_MODEL = DEFAULT_HOGLET_MODEL;
const HEDGEHOG_EFFORT = "max";
const MAX_TOKENS = 4_000;
const TICK_WINDOW_MS = 60 * 60_000;
const LOCKSTEP_SILENCE_MIN_HOGLETS = 2;
const LOCKSTEP_SILENCE_SPAWN_WINDOW_MS = 5 * 60_000;
const LOCKSTEP_SILENCE_MIN_QUIET_MS = 30 * 60_000;
const SILENT_HOGLET_MIN_QUIET_MS = 10 * 60_000;
const PENDING_INJECTION_LOOKBACK = 100;
// Safety net only: event holds should usually release via run/PR fingerprints first.
const EVENT_HOLD_FALLBACK_TIMEOUT_SECONDS = 10 * 60;

function getHeartbeatIntervalMs(): number {
  const envOverride = process.env.HEDGEMONY_HEARTBEAT_INTERVAL_MS;
  if (envOverride) {
    const parsed = Number.parseInt(envOverride, 10);
    if (!Number.isNaN(parsed) && parsed >= 60_000 && parsed <= 600_000) {
      return parsed;
    }
  }
  return DEFAULT_HEARTBEAT_INTERVAL_MS;
}

/**
 * Slice 6 of Hedgemony — the hedgehog. A per-nest ephemeral orchestrator that
 * ticks on (heartbeat | new hoglet event | operator chat message), assembles
 * fresh context from sqlite, calls Claude with the constrained tool list, and
 * dispatches each tool_use block back to a service method. State persists in
 * `hedgemony_hedgehog_state` so force-quit mid-tick recovers cleanly.
 *
 * NOT a Task. NOT a long-running agent. The service singleton owns the
 * scheduler and dispatch; each tick is a one-shot function over `(nest,
 * hoglets, recent chat, scratchpad)`.
 */
@injectable()
export class HedgehogTickService {
  private started = false;
  private readonly inFlight = new Set<string>();
  private readonly lastEnqueuedAt = new Map<string, number>();
  private readonly tickAbortControllers = new Map<string, AbortController>();
  private heartbeatHandle: ReturnType<typeof setInterval> | null = null;
  private readonly onNestChanged = (data: NestChangedEvent): void => {
    this.handleNestEvent(data);
  };
  private readonly onHogletChanged = (data: HogletChangedEvent): void => {
    this.handleHogletEvent(data);
  };

  constructor(
    @inject(MAIN_TOKENS.LlmGatewayService)
    private readonly llm: LlmGatewayService,
    @inject(MAIN_TOKENS.NestService)
    private readonly nestService: NestService,
    @inject(MAIN_TOKENS.HogletService)
    private readonly hogletService: HogletService,
    @inject(MAIN_TOKENS.NestChatService)
    private readonly nestChat: NestChatService,
    @inject(MAIN_TOKENS.HedgehogStateRepository)
    private readonly stateRepo: HedgehogStateRepository,
    @inject(MAIN_TOKENS.CloudTaskClient)
    private readonly cloudTasks: CloudTaskClient,
    @inject(MAIN_TOKENS.PrDependencyRepository)
    private readonly prDependencies: PrDependencyRepository,
    @inject(MAIN_TOKENS.PrGraphService)
    private readonly prGraph: PrGraphService,
    @inject(MAIN_TOKENS.GitService)
    private readonly git: GitService,
    @inject(MAIN_TOKENS.FeedbackRoutingService)
    private readonly feedbackRouting: FeedbackRoutingService,
    @inject(MAIN_TOKENS.FeedbackEventRepository)
    private readonly feedbackEvents: FeedbackEventRepository,
    @inject(MAIN_TOKENS.RepositoryRepository)
    private readonly repositoryRepo: RepositoryRepository,
    @inject(MAIN_TOKENS.TickLogRepository)
    private readonly tickLog: TickLogRepository,
    @inject(MAIN_TOKENS.OperatorDecisionRepository)
    private readonly operatorDecisions: OperatorDecisionRepository,
    @inject(MAIN_TOKENS.UsageAttributionService)
    private readonly usageAttribution: UsageAttributionService,
  ) {}

  /**
   * Idempotent. Subscribes to nest/hoglet events, starts the heartbeat, and
   * resets any DB rows stuck in `ticking` (left over from a force-quit).
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    // Reset any `ticking` rows from a previous boot so we don't render a
    // stuck glow forever.
    const reset = this.stateRepo.resetStuckTicks();
    for (const row of reset) {
      this.nestService.emitHedgehogTick(row.nestId, {
        state: "idle",
        lastTickAt: row.lastTickAt,
      });
    }

    this.nestService.on(HedgemonyEvent.NestChanged, this.onNestChanged);
    this.hogletService.on(HedgemonyEvent.HogletChanged, this.onHogletChanged);

    this.heartbeatHandle = setInterval(() => {
      this.runHeartbeat().catch((error) =>
        log.error("heartbeat tick failed", { error }),
      );
    }, SCHEDULER_POLL_INTERVAL_MS);

    log.info("HedgehogTickService started", {
      schedulerPollIntervalMs: SCHEDULER_POLL_INTERVAL_MS,
      defaultHeartbeatIntervalMs: getHeartbeatIntervalMs(),
    });
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.heartbeatHandle) {
      clearInterval(this.heartbeatHandle);
      this.heartbeatHandle = null;
    }
    this.nestService.off(HedgemonyEvent.NestChanged, this.onNestChanged);
    this.hogletService.off(HedgemonyEvent.HogletChanged, this.onHogletChanged);
    for (const [nestId, controller] of this.tickAbortControllers) {
      controller.abort();
      this.stateRepo.upsert({ nestId, state: "idle" });
    }
    this.tickAbortControllers.clear();
    this.inFlight.clear();
    log.info("HedgehogTickService stopped");
  }

  /**
   * Schedule a tick for `nestId`. Debounces within `MIN_TICK_INTERVAL_MS`,
   * no-ops if a tick is already in flight. Returns the (fire-and-forget)
   * promise for tests and callers that want to await completion.
   */
  enqueueTick(nestId: string, reason: string): Promise<void> {
    if (!this.started) {
      // Allow direct calls from tests without start().
      log.debug("enqueueTick before start()", { nestId, reason });
    }
    const now = Date.now();
    const last = this.lastEnqueuedAt.get(nestId) ?? 0;
    if (now - last < MIN_TICK_INTERVAL_MS) {
      log.debug("tick debounced", {
        nestId,
        reason,
        elapsedMs: now - last,
      });
      return Promise.resolve();
    }
    if (this.inFlight.has(nestId)) {
      log.debug("tick already in flight", { nestId, reason });
      return Promise.resolve();
    }
    this.lastEnqueuedAt.set(nestId, now);
    return this.runTick(nestId, reason).catch((error) => {
      log.error("tick failed", { nestId, reason, error });
    });
  }

  private handleNestEvent(data: NestChangedEvent): void {
    const event = data.event;
    if (event.kind === "message_appended") {
      if (event.message.kind === "user_message") {
        // Operator chat → trigger tick.
        void this.enqueueTick(data.nestId, "operator_chat");
      } else if (isHogletOutputMessage(event.message)) {
        void this.enqueueTick(data.nestId, "hoglet_output");
      }
      return;
    }
    if (event.kind === "status" && event.nest.status === "active") {
      // Newly created/unarchived → kick off an initial tick.
      void this.enqueueTick(data.nestId, "nest_status_active");
    }
  }

  private handleHogletEvent(data: HogletChangedEvent): void {
    if (data.bucket.kind !== "nest") return;
    // Adoption / release inside a nest is a good trigger.
    void this.enqueueTick(data.bucket.nestId, "hoglet_roster_changed");
  }

  private async runHeartbeat(): Promise<void> {
    const globalInterval = getHeartbeatIntervalMs();
    const activeNests = this.nestService
      .list()
      .filter((n) => n.status === "active");
    const activeNestIds = new Set(activeNests.map((nest) => nest.id));
    this.pruneLastEnqueuedAt(activeNestIds);

    const dueNestIds: string[] = [];
    for (const nest of activeNests) {
      const loadout = parseNestLoadout(nest.loadoutJson);
      const interval = loadout.heartbeatIntervalMs ?? globalInterval;
      const state = this.stateRepo.findByNestId(nest.id);
      const last = state?.lastTickAt ? new Date(state.lastTickAt).getTime() : 0;
      if (Date.now() - last < interval) continue;
      dueNestIds.push(nest.id);
    }
    await Promise.all(
      dueNestIds.map((nestId) => this.enqueueTick(nestId, "heartbeat")),
    );
  }

  private async runTick(nestId: string, reason: string): Promise<void> {
    if (this.inFlight.has(nestId)) return;
    this.inFlight.add(nestId);
    const abortController = new AbortController();
    this.tickAbortControllers.set(nestId, abortController);
    try {
      await this.tick(nestId, reason, abortController.signal);
    } finally {
      if (this.tickAbortControllers.get(nestId) === abortController) {
        this.tickAbortControllers.delete(nestId);
      }
      this.inFlight.delete(nestId);
    }
  }

  /**
   * The full tick lifecycle. Public for tests; production callers should use
   * `enqueueTick` so debouncing and the in-flight lock apply.
   */
  async tick(
    nestId: string,
    reason: string,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    if (abortSignal?.aborted) return;
    const nest = (() => {
      try {
        return this.nestService.get({ id: nestId });
      } catch {
        return null;
      }
    })();
    if (!nest || nest.status !== "active") {
      log.debug("tick skipped — nest missing or inactive", { nestId });
      return;
    }

    let releasedHoldScratchpad: ScratchpadEntry | null = null;
    const initialPersistedState = this.loadPersistedState(nestId);
    if (initialPersistedState.activeHold) {
      const holdCheck = await this.evaluateActiveHold(
        nest,
        initialPersistedState.activeHold,
      );
      if (!holdCheck.released) {
        const lastTickAt = new Date().toISOString();
        this.stateRepo.upsert({
          nestId,
          state: "idle",
          lastTickAt,
          serializedStateJson: JSON.stringify(initialPersistedState),
        });
        this.nestService.emitHedgehogTick(nestId, {
          state: "idle",
          lastTickAt,
        });
        return;
      }

      releasedHoldScratchpad = {
        ts: new Date().toISOString(),
        kind: "observation",
        summary: `Hold released: ${holdCheck.reason}`,
      };
      // Persist the release before the cap check below, which can return
      // before the final state write runs.
      this.stateRepo.upsert({
        nestId,
        serializedStateJson: JSON.stringify({
          ...initialPersistedState,
          activeHold: null,
        }),
      });
    }

    // Enforce the hourly cap before doing any work. The window is the last
    // hour from now; `capped` rows count too so a flood of capped attempts
    // self-quenches.
    const cap = getHedgemonyMaxTicksPerHour();
    const windowStart = new Date(Date.now() - TICK_WINDOW_MS).toISOString();
    const recentTicks = this.tickLog.countSince(nestId, windowStart);
    if (recentTicks >= cap) {
      this.tickLog.insert({ nestId, outcome: "capped" });
      log.warn("hedgehog tick capped", {
        nestId,
        reason,
        cap,
        recentTicks,
      });
      this.writeNestMessage(nestId, {
        kind: "audit",
        body: `Hedgehog tick capped: ${recentTicks} ticks already in the last hour (cap=${cap}).`,
        visibility: "summary",
        payloadJson: {
          type: "tick_capped",
          tickReason: reason,
          cap,
          recentTicks,
        },
      });
      return;
    }

    // Move state → ticking, emit so the glow turns on.
    this.stateRepo.upsert({ nestId, state: "ticking" });
    this.nestService.emitHedgehogTick(nestId, {
      state: "ticking",
      lastTickAt: this.stateRepo.findByNestId(nestId)?.lastTickAt ?? null,
    });

    const newScratchpadEntries: ScratchpadEntry[] = [];
    if (releasedHoldScratchpad) {
      newScratchpadEntries.push(releasedHoldScratchpad);
    }
    const budget = new TickBudget();
    const deps = this.buildHandlerDeps();
    let outcome: TickOutcome = "completed";
    let observedTerminalRunKeys: Record<string, string> | null = null;
    let nextActiveHold: ActiveHoldState | null = null;

    try {
      const recentChat = this.nestChat.list({ nestId, detail: false });
      const context = await this.buildContext(nest, budget, recentChat);
      if (abortSignal?.aborted) {
        outcome = "aborted";
        return;
      }
      const persistedState = this.loadPersistedState(nestId);
      observedTerminalRunKeys = this.emitNewTerminalHogletChanges(
        context.hoglets,
        persistedState.observedTerminalRunKeys,
      );
      const repositoryContext = this.deriveRepositoryContext(
        nest,
        recentChat,
        context.hoglets,
      );
      const tickContext = { ...context, repositoryContext };
      const scratchpad = persistedState.scratchpad;
      const userPrompt = buildUserPrompt({
        nest,
        hoglets: tickContext.hoglets,
        recentChat,
        scratchpad,
        triggerReason: reason,
        prDependencies: tickContext.prDependencies,
        loadout: tickContext.loadout,
        repositoryContext,
        nestAnomalies: tickContext.nestAnomalies,
        operatorDecisions: tickContext.operatorDecisions,
      });

      const response = await this.llm.promptWithTools(
        [{ role: "user", content: userPrompt }],
        {
          system: HEDGEHOG_SYSTEM_PROMPT,
          maxTokens: MAX_TOKENS,
          model: HEDGEHOG_MODEL,
          effort: HEDGEHOG_EFFORT,
          tools: HEDGEHOG_TOOLS,
          toolChoice: { type: "auto" },
          signal: abortSignal,
        },
      );
      if (abortSignal?.aborted) {
        outcome = "aborted";
        return;
      }

      newScratchpadEntries.push(...this.summariseLlmResponse(reason, response));

      try {
        this.usageAttribution.recordHedgehogTick({
          nestId: nest.id,
          model: response.model,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
        });
      } catch (error) {
        log.warn("Failed to record hedgehog tick usage", {
          nestId: nest.id,
          error: stringifyError(error),
        });
      }

      let suppressFreeTextMessage = false;
      for (const block of response.toolUseBlocks) {
        if (abortSignal?.aborted) {
          outcome = "aborted";
          return;
        }
        const handler = HEDGEHOG_HANDLERS.get(
          block.name as Parameters<typeof HEDGEHOG_HANDLERS.get>[0],
        );
        if (!handler) {
          log.warn("unknown tool name from hedgehog", { name: block.name });
          newScratchpadEntries.push({
            ts: new Date().toISOString(),
            kind: "decision",
            summary: `Ignored unknown tool ${block.name}`,
          });
          continue;
        }
        const result = await handler.handle(tickContext, block, deps);
        newScratchpadEntries.push({
          ts: new Date().toISOString(),
          kind: "decision",
          summary: result.scratchpadSummary,
        });
        if (result.hold) {
          nextActiveHold = this.buildActiveHoldState(
            result.hold,
            tickContext,
            recentChat,
          );
          suppressFreeTextMessage = true;
        }
        if (result.stopDispatch) break;
      }

      // Free-form text from the model also gets a single scratchpad note so
      // the next tick can see her reasoning.
      const combinedText = response.textBlocks
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .join("\n");
      if (combinedText.length > 0) {
        if (suppressFreeTextMessage) {
          newScratchpadEntries.push({
            ts: new Date().toISOString(),
            kind: "note",
            summary: `Hold reasoning: ${truncateForScratchpad(combinedText)}`,
          });
        } else {
          this.writeNestMessage(nestId, {
            kind: "hedgehog_message",
            body: combinedText,
            visibility: "summary",
            payloadJson: {
              tickReason: reason,
              stopReason: response.stopReason,
            },
          });
        }
      }
    } catch (error) {
      if (abortSignal?.aborted || isAbortError(error)) {
        log.debug("tick aborted", { nestId, reason });
        outcome = "aborted";
        return;
      }
      outcome = "errored";
      log.error("tick body errored", { nestId, reason, error });
      newScratchpadEntries.push({
        ts: new Date().toISOString(),
        kind: "observation",
        summary: `Tick errored: ${stringifyError(error)}`,
      });
      this.writeNestMessage(nestId, {
        kind: "audit",
        body: `Hedgehog tick errored: ${stringifyError(error)}`,
        visibility: "summary",
        payloadJson: { tickReason: reason, type: "tick_error" },
      });
    } finally {
      try {
        this.tickLog.insert({ nestId, outcome });
      } catch (logError) {
        log.warn("failed to insert tick log row", {
          nestId,
          outcome,
          error: stringifyError(logError),
        });
      }
      if (!abortSignal?.aborted) {
        const persistedState = this.loadPersistedState(nestId);
        const nextScratchpad = appendScratchpad(
          persistedState.scratchpad,
          newScratchpadEntries,
        );
        const lastTickAt = new Date().toISOString();
        this.stateRepo.upsert({
          nestId,
          state: "idle",
          lastTickAt,
          serializedStateJson: JSON.stringify({
            scratchpad: nextScratchpad,
            observedTerminalRunKeys:
              observedTerminalRunKeys ?? persistedState.observedTerminalRunKeys,
            activeHold: nextActiveHold,
          }),
        });
        this.nestService.emitHedgehogTick(nestId, {
          state: "idle",
          lastTickAt,
        });
      }
    }
  }

  private buildHandlerDeps(): HedgehogToolDeps {
    return {
      cloudTasks: this.cloudTasks,
      prGraph: this.prGraph,
      feedbackRouting: this.feedbackRouting,
      hogletService: this.hogletService,
      nestService: this.nestService,
      writeNestMessage: (nestId, input) => this.writeNestMessage(nestId, input),
    };
  }

  private async evaluateActiveHold(
    nest: Nest,
    hold: ActiveHoldState,
  ): Promise<{ released: boolean; reason: string }> {
    const recentChat = this.nestChat.list({ nestId: nest.id, detail: false });
    const latestOperator = latestOperatorMessageAt(recentChat);
    if (
      isAfterBaseline(
        latestOperator,
        hold.lastOperatorMessageAt ?? hold.createdAt,
      )
    ) {
      return { released: true, reason: "operator response arrived" };
    }

    const timeoutAt = holdTimeoutAt(hold);
    if (timeoutAt && Date.now() >= Date.parse(timeoutAt)) {
      return {
        released: true,
        reason:
          hold.nextTrigger === "timeout"
            ? "timeout fired"
            : "hold fallback timeout fired",
      };
    }

    if (hold.nextTrigger === "timeout") {
      return { released: false, reason: "timeout still pending" };
    }

    if (hold.nextTrigger === "operator_response") {
      return { released: false, reason: "awaiting operator response" };
    }

    if (hold.nextTrigger === "hoglet_output") {
      const latest = latestHogletOutputAt(recentChat);
      if (isAfterBaseline(latest, hold.lastHogletOutputAt ?? hold.createdAt)) {
        return { released: true, reason: "hoglet output arrived" };
      }
      const context = await this.buildContext(
        nest,
        new TickBudget(),
        recentChat,
      );
      const currentFingerprint = prStatusFingerprint(
        context.hoglets,
        context.prDependencies,
      );
      if (
        hold.prStatusFingerprint &&
        currentFingerprint !== hold.prStatusFingerprint
      ) {
        return { released: true, reason: "hoglet run state changed" };
      }
      return { released: false, reason: "awaiting hoglet output" };
    }

    const context = await this.buildContext(nest, new TickBudget(), recentChat);
    const currentFingerprint = prStatusFingerprint(
      context.hoglets,
      context.prDependencies,
    );
    if (currentFingerprint !== hold.prStatusFingerprint) {
      return { released: true, reason: "PR status changed" };
    }
    return { released: false, reason: "awaiting PR status change" };
  }

  private buildActiveHoldState(
    hold: NonNullable<HandlerResult["hold"]>,
    ctx: TickContext,
    recentChat: NestMessage[],
  ): ActiveHoldState {
    const createdAt = new Date().toISOString();
    const timeoutSeconds =
      hold.timeoutSeconds ?? EVENT_HOLD_FALLBACK_TIMEOUT_SECONDS;
    return {
      reason: hold.reason,
      nextTrigger: hold.nextTrigger,
      timeoutSeconds,
      createdAt,
      timeoutAt: new Date(
        Date.parse(createdAt) + timeoutSeconds * 1000,
      ).toISOString(),
      lastOperatorMessageAt: latestOperatorMessageAt(recentChat),
      lastHogletOutputAt: latestHogletOutputAt(recentChat),
      prStatusFingerprint: prStatusFingerprint(ctx.hoglets, ctx.prDependencies),
    };
  }

  private async buildContext(
    nest: Nest,
    budget: TickBudget,
    recentChat: NestMessage[],
  ): Promise<TickContext> {
    const rawLoadout = parseNestLoadout(nest.loadoutJson);
    const runtime = resolveHogletRuntime(rawLoadout, readUserTaskPreferences());
    const loadout: NestLoadout = {
      ...rawLoadout,
      runtimeAdapter: runtime.runtimeAdapter,
      model: runtime.model,
      reasoningEffort: runtime.reasoningEffort,
      environment: runtime.environment,
    };
    if (runtime.executionMode !== "bypassPermissions") {
      loadout.executionMode = runtime.executionMode;
    }
    const hoglets = this.hogletService
      .list({ nestId: nest.id })
      .filter((h): h is Hoglet => !h.deletedAt);
    const feedbackEvents = this.feedbackEvents.listForNest(
      nest.id,
      PENDING_INJECTION_LOOKBACK,
    );
    const enriched: HogletWithState[] = [];
    const prStateCache = new Map<string, HogletPrState>();
    const prBranchCache = new Map<
      string,
      { prUrl: string; prState: HogletPrState } | null
    >();
    for (const hoglet of hoglets) {
      try {
        const { task, latestRun } = await this.cloudTasks.getTaskWithLatestRun(
          hoglet.taskId,
        );
        const prUrlCandidate = latestRun?.output?.pr_url;
        let prUrl =
          typeof prUrlCandidate === "string" && prUrlCandidate.length > 0
            ? prUrlCandidate
            : null;
        let prState = prUrl
          ? await this.resolvePrState(prUrl, prStateCache)
          : null;
        if (!prUrl && task.repository && latestRun?.branch) {
          const inferred = await this.resolvePrFromBranch(
            task.repository,
            latestRun.branch,
            prBranchCache,
          );
          if (inferred) {
            prUrl = inferred.prUrl;
            prState = inferred.prState;
          }
        }
        const entry: Omit<HogletWithState, "pendingInjections"> = {
          hoglet,
          repository: task.repository ?? null,
          taskRunStatus: latestRun?.status ?? "no_run",
          latestRunId: latestRun?.id ?? null,
          branch: latestRun?.branch ?? null,
          prUrl,
          prState,
          latestRunCreatedAt: latestRun?.created_at ?? null,
          latestRunCompletedAt: latestRun?.completed_at ?? null,
          lastOutputAt: null,
          lastOutputKind: null,
          lastOutputPreview: null,
        };
        const withOutput = {
          ...entry,
          ...deriveHogletLastOutput(entry, recentChat),
        };
        enriched.push({
          ...withOutput,
          pendingInjections: computePendingInjections(
            withOutput,
            feedbackEvents,
          ),
        });
      } catch (error) {
        log.warn("could not load task state — flagging as unknown", {
          taskId: hoglet.taskId,
          error: stringifyError(error),
        });
        const entry: Omit<HogletWithState, "pendingInjections"> = {
          hoglet,
          repository: null,
          taskRunStatus: "unknown",
          latestRunId: null,
          branch: null,
          prUrl: null,
          prState: null,
          latestRunCreatedAt: null,
          latestRunCompletedAt: null,
          lastOutputAt: null,
          lastOutputKind: null,
          lastOutputPreview: null,
        };
        const withOutput = {
          ...entry,
          ...deriveHogletLastOutput(entry, recentChat),
        };
        enriched.push({
          ...withOutput,
          pendingInjections: computePendingInjections(
            withOutput,
            feedbackEvents,
          ),
        });
      }
    }
    const prDeps = this.prDependencies.listForNest(nest.id);
    const operatorDecisions = this.operatorDecisions.listForNest(nest.id);
    return {
      nest,
      hoglets: enriched,
      budget,
      prDependencies: prDeps,
      loadout,
      nestAnomalies: computeNestAnomalies(enriched),
      operatorDecisions,
      repositoryContext: {
        repositories: [],
        primaryRepository: null,
        availableRepositories: [],
      },
    };
  }

  private deriveRepositoryContext(
    nest: Nest,
    recentChat: NestMessage[],
    hoglets: HogletWithState[],
  ): {
    repositories: string[];
    primaryRepository: string | null;
    availableRepositories: string[];
  } {
    const repositories = new Set<string>();
    const grantedRepositories = new Set<string>();
    let primaryRepository: string | null = null;

    const addRepository = (value: unknown): void => {
      if (typeof value !== "string") return;
      const trimmed = value.trim();
      if (trimmed.length > 0) repositories.add(trimmed);
    };

    const addRepositories = (value: unknown): void => {
      if (!Array.isArray(value)) return;
      for (const entry of value) addRepository(entry);
    };

    for (const message of recentChat) {
      if (message.payloadJson) {
        try {
          const raw = JSON.parse(message.payloadJson) as Record<
            string,
            unknown
          >;
          if (
            raw.type === "repository_access_granted" &&
            typeof raw.repository === "string"
          ) {
            grantedRepositories.add(raw.repository.trim());
          }
        } catch {}
      }

      const payload = parseNestChatCreationBootstrapPayload(
        message.payloadJson,
      );
      if (!payload) continue;
      const bootstrap = payload.creationBootstrap ?? payload;
      addRepositories(bootstrap.repositories);
      addRepository(bootstrap.primaryRepository ?? null);
      if (
        !primaryRepository &&
        typeof bootstrap.primaryRepository === "string"
      ) {
        const trimmed = bootstrap.primaryRepository.trim();
        if (trimmed.length > 0) primaryRepository = trimmed;
      }
    }

    for (const entry of hoglets) addRepository(entry.repository);

    if (!primaryRepository && nest.primaryRepository) {
      primaryRepository = nest.primaryRepository;
    }

    const list = [...repositories];
    if (!primaryRepository && list.length === 1) {
      primaryRepository = list[0] ?? null;
    }

    const available = new Set(this.listAvailableRepositorySlugs());
    for (const repo of repositories) available.add(repo);
    for (const repo of grantedRepositories) available.add(repo);
    if (nest.primaryRepository) available.add(nest.primaryRepository);

    return {
      repositories: list,
      primaryRepository,
      availableRepositories: [...available].sort(),
    };
  }

  /**
   * Builds the list of "owner/repo" slugs the hedgehog can choose from,
   * sourced from every PostHog Code repository row on the operator's machine.
   * Each remoteUrl is normalised through parseGithubUrl (handles HTTPS, SSH,
   * shorthand) and falls back to normalizeRepoKey for non-GitHub remotes.
   */
  private listAvailableRepositorySlugs(): string[] {
    const slugs = new Set<string>();
    let rows: ReturnType<RepositoryRepository["findAll"]>;
    try {
      rows = this.repositoryRepo.findAll();
    } catch (error) {
      log.warn("repositoryRepo.findAll failed; available_repositories empty", {
        error: stringifyError(error),
      });
      return [];
    }
    for (const row of rows) {
      const remote = row.remoteUrl;
      if (!remote) continue;
      const parsed = parseGithubUrl(remote);
      if (parsed && parsed.kind === "repo") {
        slugs.add(`${parsed.owner}/${parsed.repo}`);
        continue;
      }
      const normalised = normalizeRepoKey(remote);
      if (normalised.length > 0 && normalised.includes("/")) {
        slugs.add(normalised);
      }
    }
    return [...slugs].sort();
  }

  private async resolvePrState(
    prUrl: string,
    cache: Map<string, HogletPrState>,
  ): Promise<HogletPrState> {
    const cached = cache.get(prUrl);
    if (cached !== undefined) return cached;
    try {
      const status = await this.git.getPrDetailsByUrl(prUrl);
      const resolved: HogletPrState = status
        ? this.prDetailsToState(status)
        : "unknown";
      cache.set(prUrl, resolved);
      return resolved;
    } catch (error) {
      log.debug("getPrDetailsByUrl failed inside hedgehog tick", {
        prUrl,
        error: stringifyError(error),
      });
      cache.set(prUrl, "unknown");
      return "unknown";
    }
  }

  private async resolvePrFromBranch(
    repository: string,
    branch: string,
    cache: Map<string, { prUrl: string; prState: HogletPrState } | null>,
  ): Promise<{ prUrl: string; prState: HogletPrState } | null> {
    const key = `${repository}:${branch}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    try {
      const status = await this.git.getPrDetailsByBranch(repository, branch);
      const resolved = status
        ? {
            prUrl: status.url,
            prState: this.prDetailsToState(status),
          }
        : null;
      cache.set(key, resolved);
      return resolved;
    } catch (error) {
      log.debug("getPrDetailsByBranch failed inside hedgehog tick", {
        repository,
        branch,
        error: stringifyError(error),
      });
      cache.set(key, null);
      return null;
    }
  }

  private prDetailsToState(status: {
    state: string;
    merged: boolean;
    draft: boolean;
  }): HogletPrState {
    if (status.merged) return "merged";
    if (status.draft) return "draft";
    if (status.state === "closed") return "closed";
    return "open";
  }

  private loadPersistedState(nestId: string): {
    scratchpad: ScratchpadEntry[];
    observedTerminalRunKeys: Record<string, string>;
    activeHold: ActiveHoldState | null;
  } {
    const row = this.stateRepo.findByNestId(nestId);
    return parseHedgehogState(row?.serializedStateJson ?? null);
  }

  private emitNewTerminalHogletChanges(
    hoglets: HogletWithState[],
    previousObservedRunKeys: Record<string, string>,
  ): Record<string, string> {
    const nextObservedRunKeys: Record<string, string> = {};
    for (const entry of hoglets) {
      const runKey = terminalRunKey(entry);
      if (!runKey) continue;
      nextObservedRunKeys[entry.hoglet.taskId] = runKey;
      if (previousObservedRunKeys[entry.hoglet.taskId] !== runKey) {
        this.hogletService.emitChanged(entry.hoglet);
      }
    }
    return nextObservedRunKeys;
  }

  private summariseLlmResponse(
    reason: string,
    response: PromptWithToolsOutput,
  ): ScratchpadEntry[] {
    return [
      {
        ts: new Date().toISOString(),
        kind: "observation",
        summary: `Tick ran (reason=${reason}, model=${response.model}, stop=${response.stopReason ?? "?"}, tools=${response.toolUseBlocks.length}, in=${response.usage.inputTokens}, out=${response.usage.outputTokens}).`,
      },
    ];
  }

  private writeNestMessage(nestId: string, input: WriteNestMessageInput): void {
    const message = this.nestChat.recordHedgehogMessage({
      nestId,
      kind: input.kind,
      body: input.body,
      visibility: input.visibility ?? "summary",
      sourceTaskId: input.sourceTaskId ?? null,
      payloadJson: input.payloadJson ?? null,
    });
    this.nestService.emitMessageAppended(message);
  }

  private pruneLastEnqueuedAt(activeNestIds: Set<string>): void {
    for (const nestId of this.lastEnqueuedAt.keys()) {
      if (!activeNestIds.has(nestId) && !this.inFlight.has(nestId)) {
        this.lastEnqueuedAt.delete(nestId);
      }
    }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function isTerminalTaskRunStatus(
  status: HogletWithState["taskRunStatus"],
): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

function terminalRunKey(entry: HogletWithState): string | null {
  if (!isTerminalTaskRunStatus(entry.taskRunStatus)) return null;
  return [
    entry.latestRunId ?? "missing-run-id",
    entry.taskRunStatus,
    entry.latestRunCompletedAt ?? "missing-completed-at",
  ].join(":");
}

function computePendingInjections(
  entry: Pick<HogletWithState, "hoglet" | "lastOutputAt">,
  feedbackEvents: ReturnType<FeedbackEventRepository["listForNest"]>,
): HogletWithState["pendingInjections"] {
  const lastOutputMs = parseTimestamp(entry.lastOutputAt);
  const pending = feedbackEvents.filter((event) => {
    if (event.hogletTaskId !== entry.hoglet.taskId) return false;
    if (event.source !== "hedgehog") return false;
    if (event.routedOutcome !== "injected") return false;
    const processed = event.processed ?? "unknown";
    // Only explicit queued injections are blockers. Some cloud command
    // responses cannot report processing state and come back as "unknown"
    // even after delivery, so treating unknown as queued can strand the hedge.
    if (processed !== "queued") return false;
    const injectedMs = parseTimestamp(event.injectedAt);
    if (injectedMs === null) return false;
    return lastOutputMs === null || lastOutputMs <= injectedMs;
  });

  if (pending.length === 0) {
    return { count: 0, oldestAgeMinutes: null };
  }
  const oldestMs = Math.min(
    ...pending
      .map((event) => parseTimestamp(event.injectedAt))
      .filter((value): value is number => value !== null),
  );
  return {
    count: pending.length,
    oldestAgeMinutes: Math.max(0, Math.floor((Date.now() - oldestMs) / 60_000)),
  };
}

function computeNestAnomalies(
  hoglets: HogletWithState[],
): TickContext["nestAnomalies"] {
  const now = Date.now();
  const anomalies: TickContext["nestAnomalies"] = {};
  const silentActive = hoglets
    .map((entry) => ({
      entry,
      runCreatedMs: parseTimestamp(entry.latestRunCreatedAt),
    }))
    .filter(
      (item): item is { entry: HogletWithState; runCreatedMs: number } =>
        item.runCreatedMs !== null &&
        item.entry.taskRunStatus === "in_progress" &&
        entryHasNoOutput(item.entry) &&
        now - item.runCreatedMs >= SILENT_HOGLET_MIN_QUIET_MS,
    )
    .sort((a, b) => a.runCreatedMs - b.runCreatedMs);
  if (silentActive.length > 0) {
    const oldestMs = Math.min(...silentActive.map((item) => item.runCreatedMs));
    anomalies.silentHoglets = {
      hogletIds: silentActive.map((item) => item.entry.hoglet.id),
      oldestSilentMinutes: Math.max(0, Math.floor((now - oldestMs) / 60_000)),
    };
  }

  const silent = hoglets
    .map((entry) => ({
      entry,
      createdMs: parseTimestamp(entry.hoglet.createdAt),
    }))
    .filter(
      (item): item is { entry: HogletWithState; createdMs: number } =>
        item.createdMs !== null &&
        entryHasNoOutput(item.entry) &&
        now - item.createdMs >= LOCKSTEP_SILENCE_MIN_QUIET_MS,
    )
    .sort((a, b) => a.createdMs - b.createdMs);

  for (let start = 0; start < silent.length; start += 1) {
    const group = silent.filter(
      (item) =>
        item.createdMs >= silent[start].createdMs &&
        item.createdMs - silent[start].createdMs <=
          LOCKSTEP_SILENCE_SPAWN_WINDOW_MS,
    );
    if (group.length >= LOCKSTEP_SILENCE_MIN_HOGLETS) {
      const oldestMs = Math.min(...group.map((item) => item.createdMs));
      anomalies.lockstepSilence = {
        hogletIds: group.map((item) => item.entry.hoglet.id),
        sinceMinutes: Math.max(0, Math.floor((now - oldestMs) / 60_000)),
      };
      return anomalies;
    }
  }

  return anomalies;
}

function entryHasNoOutput(entry: HogletWithState): boolean {
  return entry.lastOutputAt === null;
}

function latestOperatorMessageAt(recentChat: NestMessage[]): string | null {
  return latestMessageAt(
    recentChat,
    (message) => message.kind === "user_message",
  );
}

function latestHogletOutputAt(recentChat: NestMessage[]): string | null {
  return latestMessageAt(recentChat, isHogletOutputMessage);
}

function isHogletOutputMessage(message: NestMessage): boolean {
  return message.sourceTaskId !== null && HOGLET_OUTPUT_KINDS.has(message.kind);
}

function latestMessageAt(
  messages: NestMessage[],
  predicate: (message: NestMessage) => boolean,
): string | null {
  let latest: string | null = null;
  let latestMs: number | null = null;
  for (const message of messages) {
    if (!predicate(message)) continue;
    const createdMs = parseTimestamp(message.createdAt);
    if (createdMs === null) continue;
    if (latestMs === null || createdMs > latestMs) {
      latest = new Date(createdMs).toISOString();
      latestMs = createdMs;
    }
  }
  return latest;
}

function isAfterBaseline(
  value: string | null,
  baseline: string | null,
): boolean {
  const valueMs = parseTimestamp(value);
  if (valueMs === null) return false;
  const baselineMs = parseTimestamp(baseline);
  return baselineMs === null ? true : valueMs > baselineMs;
}

function holdTimeoutAt(hold: ActiveHoldState): string | null {
  if (hold.nextTrigger === "timeout" && hold.timeoutAt) return hold.timeoutAt;
  const timeoutSeconds =
    hold.nextTrigger === "timeout"
      ? (hold.timeoutSeconds ?? EVENT_HOLD_FALLBACK_TIMEOUT_SECONDS)
      : Math.min(
          hold.timeoutSeconds ?? EVENT_HOLD_FALLBACK_TIMEOUT_SECONDS,
          EVENT_HOLD_FALLBACK_TIMEOUT_SECONDS,
        );
  const createdMs = parseTimestamp(hold.createdAt);
  if (createdMs === null) return null;
  return new Date(createdMs + timeoutSeconds * 1000).toISOString();
}

function prStatusFingerprint(
  hoglets: HogletWithState[],
  prDependencies: TickContext["prDependencies"],
): string {
  return JSON.stringify({
    hoglets: hoglets
      .map((entry) => ({
        taskId: entry.hoglet.taskId,
        latestRunId: entry.latestRunId,
        taskRunStatus: entry.taskRunStatus,
        latestRunCompletedAt: entry.latestRunCompletedAt,
        prUrl: entry.prUrl,
        prState: entry.prState,
        branch: entry.branch,
      }))
      .sort((a, b) => a.taskId.localeCompare(b.taskId)),
    prDependencies: prDependencies
      .map((edge) => ({
        id: edge.id,
        parentTaskId: edge.parentTaskId,
        childTaskId: edge.childTaskId,
        state: edge.state,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function truncateForScratchpad(value: string): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  // Leave room for the "Hold reasoning: " prefix under the 1000-char
  // scratchpad schema limit.
  if (singleLine.length <= 900) return singleLine;
  return `${singleLine.slice(0, 900)}... (truncated)`;
}

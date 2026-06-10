import type { ServiceResolver } from "@posthog/host-trpc/context";
import { publicProcedure, router } from "@posthog/host-trpc/trpc";
import {
  FEEDBACK_EVENT_REPOSITORY,
  OPERATOR_DECISION_REPOSITORY,
  USAGE_EVENT_REPOSITORY,
} from "@posthog/workspace-server/db/identifiers";
import type { FeedbackEventRepository } from "@posthog/workspace-server/db/repositories/rts/feedback-event-repository";
import type { OperatorDecisionRepository } from "@posthog/workspace-server/db/repositories/rts/operator-decision-repository";
import type { UsageEventRepository } from "@posthog/workspace-server/db/repositories/rts/usage-event-repository";
import {
  FeedbackRoutingEvent,
  type FeedbackRoutingService,
} from "@posthog/workspace-server/services/rts/feedback-routing-service";
import type { GoalSpecDraftService } from "@posthog/workspace-server/services/rts/goal-spec-draft-service";
import type { HedgehogTickService } from "@posthog/workspace-server/services/rts/hedgehog-tick-service";
import type { HogletService } from "@posthog/workspace-server/services/rts/hoglet-service";
import {
  FEEDBACK_ROUTING_SERVICE,
  GOAL_SPEC_DRAFT_SERVICE,
  HEDGEHOG_TICK_SERVICE,
  HOGLET_SERVICE,
  NEST_CHAT_SERVICE,
  NEST_SERVICE,
  PR_GRAPH_SERVICE,
  SIGNAL_INGESTION_SERVICE,
  SPEC_IMPORT_SERVICE,
} from "@posthog/workspace-server/services/rts/identifiers";
import type { NestChatService } from "@posthog/workspace-server/services/rts/nest-chat-service";
import type { NestService } from "@posthog/workspace-server/services/rts/nest-service";
import {
  type PrGraphService,
  PrGraphServiceEvent,
} from "@posthog/workspace-server/services/rts/pr-graph-service";
import { parseNestLoadout } from "@posthog/workspace-server/services/rts/schema-parsers";
import {
  adoptHogletInput,
  compactValidatedNestInput,
  createNestInput,
  dismissSignalHogletInput,
  feedbackEvent,
  finopsSummary,
  finopsSummaryInput,
  goalDraftRespondInput,
  goalDraftResponse,
  hoglet,
  hogletIngestedEventPayload,
  hogletWatchEvent,
  hogletWatchScope,
  importedSpecFile,
  injectPromptEventPayload,
  linkPrDependencyInput,
  listFeedbackForNestInput,
  listFeedbackForNestOutput,
  listHogletsInput,
  listHogletsOutput,
  listNestChatInput,
  listNestChatOutput,
  listNestsOutput,
  listOperatorDecisionsInput,
  listOperatorDecisionsOutput,
  listPrDependenciesForNestInput,
  listPrDependenciesForNestOutput,
  markValidatedInput,
  nest,
  nestIdInput,
  nestMessage,
  nestWatchEvent,
  operatorDecision,
  prDependency,
  prGraphWatchEvent,
  RtsEvent,
  rebaseChildEventPayload,
  recordAdhocHogletInput,
  recordBootstrapHandoffInput,
  recordRebaseOutcomeInput,
  recordRoutedFeedbackInput,
  recordSignalBackedHogletInput,
  releaseHogletInput,
  reopenNestInput,
  retireHogletByTaskIdInput,
  retireHogletInput,
  reviveHogletInput,
  sendNestMessageInput,
  spawnFollowUpHogletInput,
  suppressSignalReportInput,
  unlinkPrDependencyInput,
  updateNestInput,
} from "@posthog/workspace-server/services/rts/schemas";
import {
  SignalIngestionEvent,
  type SignalIngestionService,
} from "@posthog/workspace-server/services/rts/signal-ingestion-service";
import type { SpecImportService } from "@posthog/workspace-server/services/rts/spec-import-service";
import { z } from "zod";

const getService = (container: ServiceResolver) =>
  container.get<NestService>(NEST_SERVICE);
const getNestChatService = (container: ServiceResolver) =>
  container.get<NestChatService>(NEST_CHAT_SERVICE);
const getGoalSpecDraftService = (container: ServiceResolver) =>
  container.get<GoalSpecDraftService>(GOAL_SPEC_DRAFT_SERVICE);
const getSpecImportService = (container: ServiceResolver) =>
  container.get<SpecImportService>(SPEC_IMPORT_SERVICE);
const getHogletService = (container: ServiceResolver) =>
  container.get<HogletService>(HOGLET_SERVICE);
const getHedgehogTickService = (container: ServiceResolver) =>
  container.get<HedgehogTickService>(HEDGEHOG_TICK_SERVICE);
const getFeedbackRoutingService = (container: ServiceResolver) =>
  container.get<FeedbackRoutingService>(FEEDBACK_ROUTING_SERVICE);
const getFeedbackEventRepository = (container: ServiceResolver) =>
  container.get<FeedbackEventRepository>(FEEDBACK_EVENT_REPOSITORY);
const getOperatorDecisionRepository = (container: ServiceResolver) =>
  container.get<OperatorDecisionRepository>(OPERATOR_DECISION_REPOSITORY);
const getPrGraphService = (container: ServiceResolver) =>
  container.get<PrGraphService>(PR_GRAPH_SERVICE);
const getSignalIngestionService = (container: ServiceResolver) =>
  container.get<SignalIngestionService>(SIGNAL_INGESTION_SERVICE);
const getUsageEventRepository = (container: ServiceResolver) =>
  container.get<UsageEventRepository>(USAGE_EVENT_REPOSITORY);

const signalIngestionStatus = z.object({
  enabled: z.boolean(),
  running: z.boolean(),
});

export const rtsRouter = router({
  goalDraft: router({
    respond: publicProcedure
      .input(goalDraftRespondInput)
      .output(goalDraftResponse)
      .mutation(({ ctx, input }) =>
        getGoalSpecDraftService(ctx.container).respond(input),
      ),

    // Opens a native picker so the operator can seed a nest from a spec file
    // on their workstation. Returns null when the picker is dismissed.
    importSpecFile: publicProcedure
      .output(importedSpecFile.nullable())
      .mutation(({ ctx }) =>
        getSpecImportService(ctx.container).importSpecFile(),
      ),
  }),
  nests: router({
    list: publicProcedure
      .output(listNestsOutput)
      .query(({ ctx }) => getService(ctx.container).list()),

    get: publicProcedure
      .input(nestIdInput)
      .output(nest)
      .query(({ ctx, input }) => getService(ctx.container).get(input)),

    create: publicProcedure
      .input(createNestInput)
      .output(nest)
      .mutation(({ ctx, input }) => getService(ctx.container).create(input)),

    update: publicProcedure
      .input(updateNestInput)
      .output(nest)
      .mutation(({ ctx, input }) => getService(ctx.container).update(input)),

    archive: publicProcedure
      .input(nestIdInput)
      .output(nest)
      .mutation(({ ctx, input }) => getService(ctx.container).archive(input)),

    markValidated: publicProcedure
      .input(markValidatedInput)
      .output(nest)
      .mutation(({ ctx, input }) =>
        getService(ctx.container).markValidated(input),
      ),

    compact: publicProcedure
      .input(compactValidatedNestInput)
      .output(nest)
      .mutation(({ ctx, input }) =>
        getService(ctx.container).compactValidatedNest(input),
      ),

    reopen: publicProcedure
      .input(reopenNestInput)
      .output(nest)
      .mutation(({ ctx, input }) =>
        getService(ctx.container).reopenValidatedNest(input),
      ),

    unarchive: publicProcedure
      .input(nestIdInput)
      .output(nest)
      .mutation(({ ctx, input }) => getService(ctx.container).unarchive(input)),

    spawnFollowUpHoglet: publicProcedure
      .input(spawnFollowUpHogletInput)
      .output(hoglet)
      .mutation(async ({ ctx, input }) => {
        const nest = getService(ctx.container).get({ id: input.nestId });
        return await getHogletService(ctx.container).spawnFollowUp(
          input,
          parseNestLoadout(nest.loadoutJson),
        );
      }),

    /**
     * Per-nest watch. Emits on status change, archive, and (later) hoglet
     * roster changes / hedgehog tick completion.
     */
    watch: publicProcedure
      .input(nestIdInput)
      .subscription(async function* (opts) {
        const service = getService(opts.ctx.container);
        const iterable = service.toIterable(RtsEvent.NestChanged, {
          signal: opts.signal,
        });
        for await (const data of iterable) {
          if (data.nestId === opts.input.id) {
            yield nestWatchEvent.parse(data.event);
          }
        }
      }),
  }),
  nestChat: router({
    list: publicProcedure
      .input(listNestChatInput)
      .output(listNestChatOutput)
      .query(({ ctx, input }) => getNestChatService(ctx.container).list(input)),

    recordBootstrapHandoff: publicProcedure
      .input(recordBootstrapHandoffInput)
      .output(nestMessage)
      .mutation(({ ctx, input }) => {
        const message = getNestChatService(
          ctx.container,
        ).recordBootstrapHandoff(input);
        getService(ctx.container).emitMessageAppended(message);
        return message;
      }),

    send: publicProcedure
      .input(sendNestMessageInput)
      .output(nestMessage)
      .mutation(({ ctx, input }) => {
        const message = getNestChatService(ctx.container).send(input);
        getService(ctx.container).emitMessageAppended(message);
        // Operator chat is a tick trigger per the spec; fire-and-forget.
        getHedgehogTickService(ctx.container).enqueueTick(
          input.nestId,
          "operator_chat",
        );
        return message;
      }),
  }),
  hoglets: router({
    recordAdhoc: publicProcedure
      .input(recordAdhocHogletInput)
      .output(hoglet)
      .mutation(({ ctx, input }) =>
        getHogletService(ctx.container).recordAdhoc(input),
      ),

    recordSignalBacked: publicProcedure
      .input(recordSignalBackedHogletInput)
      .output(hoglet)
      .mutation(
        async ({ ctx, input }) =>
          await getHogletService(ctx.container).recordSignalBacked(input),
      ),

    adopt: publicProcedure
      .input(adoptHogletInput)
      .output(hoglet)
      .mutation(({ ctx, input }) =>
        getHogletService(ctx.container).adopt(input),
      ),

    release: publicProcedure
      .input(releaseHogletInput)
      .output(hoglet)
      .mutation(({ ctx, input }) =>
        getHogletService(ctx.container).release(input),
      ),

    dismissSignal: publicProcedure
      .input(dismissSignalHogletInput)
      .output(z.void())
      .mutation(({ ctx, input }) => {
        getHogletService(ctx.container).dismissSignal(input);
      }),

    retire: publicProcedure
      .input(retireHogletInput)
      .output(z.void())
      .mutation(({ ctx, input }) => {
        getHogletService(ctx.container).retire(input);
      }),

    retireByTaskId: publicProcedure
      .input(retireHogletByTaskIdInput)
      .output(z.void())
      .mutation(({ ctx, input }) => {
        getHogletService(ctx.container).retireByTaskId(input.taskId);
      }),

    list: publicProcedure
      .input(listHogletsInput)
      .output(listHogletsOutput)
      .query(({ ctx, input }) => getHogletService(ctx.container).list(input)),

    /**
     * Per-scope watch. The map subscribes with `kind: "wild"` for every
     * non-nested hoglet (ad-hoc operator spawns + signal-backed hoglets that
     * the affinity router didn't route into a nest), and each nest's brood
     * cluster subscribes with `kind: "nest", nestId`. The service emits with
     * a `bucket` discriminator that the router matches against the scope.
     */
    watch: publicProcedure
      .input(hogletWatchScope)
      .subscription(async function* (opts) {
        const service = getHogletService(opts.ctx.container);
        const iterable = service.toIterable(RtsEvent.HogletChanged, {
          signal: opts.signal,
        });
        for await (const data of iterable) {
          const { bucket } = data;
          if (opts.input.kind === "wild" && bucket.kind === "wild") {
            yield hogletWatchEvent.parse(data.event);
          } else if (
            opts.input.kind === "nest" &&
            bucket.kind === "nest" &&
            bucket.nestId === opts.input.nestId
          ) {
            yield hogletWatchEvent.parse(data.event);
          }
        }
      }),
  }),
  feedback: router({
    /**
     * Live stream of non-hedgehog `injectPrompt` events. The renderer hook
     * `useRtsPromptRouter` subscribes once at app level and either
     * calls the existing `sendPromptToAgent` for connected sessions or
     * calls `nests.spawnFollowUpHoglet` for closed ones. Hedgehog-originated
     * messages are delivered directly from main to cloud runs.
     */
    onInjectPrompt: publicProcedure.subscription(async function* (opts) {
      const service = getFeedbackRoutingService(opts.ctx.container);
      const iterable = service.toIterable(FeedbackRoutingEvent.InjectPrompt, {
        signal: opts.signal,
      });
      for await (const data of iterable) {
        yield data;
      }
    }),

    /** Drains any events emitted before the subscription attached. */
    getPendingInjects: publicProcedure
      .output(z.array(injectPromptEventPayload))
      .query(({ ctx }) =>
        getFeedbackRoutingService(ctx.container).consumePending(),
      ),

    /**
     * Records the outcome of a routed feedback event. Inserts a
     * `rts_feedback_event` row (idempotent on the dedupe index)
     * and writes a `feedback_routed` audit row to nest chat.
     */
    recordRouted: publicProcedure
      .input(recordRoutedFeedbackInput)
      .output(feedbackEvent)
      .mutation(({ ctx, input }) =>
        getFeedbackRoutingService(ctx.container).recordRoutedOutcome(input),
      ),

    listForNest: publicProcedure
      .input(listFeedbackForNestInput)
      .output(listFeedbackForNestOutput)
      .query(({ ctx, input }) =>
        getFeedbackEventRepository(ctx.container).listForNest(
          input.nestId,
          input.limit,
        ),
      ),
  }),
  operatorDecisions: router({
    /**
     * Record that the operator has suppressed a signal report — the hedgehog
     * must not spawn a hoglet for it again. Upsert keyed on
     * (nestId, kind, signalReportId).
     */
    suppressSignalReport: publicProcedure
      .input(suppressSignalReportInput)
      .output(operatorDecision)
      .mutation(({ ctx, input }) =>
        getOperatorDecisionRepository(ctx.container).recordSuppressSignalReport(
          {
            nestId: input.nestId,
            signalReportId: input.signalReportId,
            reason: input.reason ?? null,
          },
        ),
      ),

    /**
     * Record that the operator has revived a hoglet — the hedgehog must not
     * kill it again. `subjectKey` accepts either the hoglet id or the task
     * id; the kill handler matches against both so callers can record
     * whichever they have at hand.
     */
    reviveHoglet: publicProcedure
      .input(reviveHogletInput)
      .output(operatorDecision)
      .mutation(({ ctx, input }) =>
        getOperatorDecisionRepository(ctx.container).recordReviveHoglet({
          nestId: input.nestId,
          subjectKey: input.subjectKey,
          reason: input.reason ?? null,
        }),
      ),

    listForNest: publicProcedure
      .input(listOperatorDecisionsInput)
      .output(listOperatorDecisionsOutput)
      .query(({ ctx, input }) =>
        getOperatorDecisionRepository(ctx.container).listForNest(input.nestId),
      ),
  }),
  prGraph: router({
    /**
     * Returns every edge in the nest (any state). The renderer overlay reads
     * this once on mount and patches via `watch` afterwards.
     */
    listForNest: publicProcedure
      .input(listPrDependenciesForNestInput)
      .output(listPrDependenciesForNestOutput)
      .query(({ ctx, input }) =>
        getPrGraphService(ctx.container).listForNest(input.nestId),
      ),

    /** Idempotent edge create. Used by hedgehog tool dispatch and operator UI. */
    link: publicProcedure
      .input(linkPrDependencyInput)
      .output(prDependency)
      .mutation(({ ctx, input }) =>
        getPrGraphService(ctx.container).link(input),
      ),

    unlink: publicProcedure
      .input(unlinkPrDependencyInput)
      .mutation(({ ctx, input }) => {
        getPrGraphService(ctx.container).unlink(input);
      }),

    /**
     * Per-nest edge watch. Emits on upsert (link or state change) and removed
     * (unlink, cascade-cleanup, dismiss).
     */
    watch: publicProcedure
      .input(nestIdInput)
      .subscription(async function* (opts) {
        const service = getPrGraphService(opts.ctx.container);
        for await (const data of service.toIterable(RtsEvent.PrGraphChanged, {
          signal: opts.signal,
        })) {
          if (data.nestId === opts.input.id) {
            yield prGraphWatchEvent.parse(data.event);
          }
        }
      }),

    /**
     * Live stream of `rebaseChild` events. The renderer hook
     * `useRtsPrGraphRouter` subscribes once at app level and either
     * injects the prompt into a connected session or spawns a follow-up
     * hoglet for closed ones — same shape as the feedback router.
     */
    onRebaseChild: publicProcedure.subscription(async function* (opts) {
      const service = getPrGraphService(opts.ctx.container);
      for await (const data of service.toIterable(
        PrGraphServiceEvent.RebaseChild,
        { signal: opts.signal },
      )) {
        yield data;
      }
    }),

    /** Drains any rebase events emitted before the subscription attached. */
    getPendingRebases: publicProcedure
      .output(z.array(rebaseChildEventPayload))
      .query(({ ctx }) => getPrGraphService(ctx.container).consumePending()),

    /**
     * Records the outcome of a routed rebase event. Writes the edge state
     * transition (`pending → satisfied | broken`) and a
     * `pr_graph_rebase_routed` audit row to nest chat.
     */
    recordRebaseOutcome: publicProcedure
      .input(recordRebaseOutcomeInput)
      .output(prDependency)
      .mutation(({ ctx, input }) =>
        getPrGraphService(ctx.container).recordRebaseOutcome(input),
      ),
  }),
  signalIngestion: router({
    /**
     * Idempotent start of the main-side signal ingestion poll loop. The
     * renderer calls this when the Rts map view mounts. The loop
     * survives renderer unmount — only `cancel` (an explicit operator
     * action) stops it.
     */
    start: publicProcedure.output(z.void()).mutation(({ ctx }) => {
      getSignalIngestionService(ctx.container).start();
    }),

    /** Explicit operator override — not invoked on renderer unmount. */
    cancel: publicProcedure.output(z.void()).mutation(({ ctx }) => {
      getSignalIngestionService(ctx.container).cancel();
    }),

    status: publicProcedure
      .output(signalIngestionStatus)
      .query(({ ctx }) => getSignalIngestionService(ctx.container).status()),

    setEnabled: publicProcedure
      .input(z.object({ enabled: z.boolean() }))
      .output(signalIngestionStatus)
      .mutation(({ ctx, input }) =>
        getSignalIngestionService(ctx.container).setEnabled(input.enabled),
      ),

    /**
     * Live stream of `hogletIngested` events. The renderer subscribes once
     * on map mount to fire analytics + play the arrival voice when a new
     * signal-backed hoglet appears on the map.
     */
    onIngested: publicProcedure.subscription(async function* (opts) {
      const service = getSignalIngestionService(opts.ctx.container);
      const iterable = service.toIterable(SignalIngestionEvent.HogletIngested, {
        signal: opts.signal,
      });
      for await (const data of iterable) {
        yield hogletIngestedEventPayload.parse(data);
      }
    }),
  }),
  usage: router({
    /**
     * Global FinOps summary across every nest, hoglet, and hedgehog tick.
     * Backs the "Money Hedgehog" toolbar chip and detail dialog. Gated in the
     * UI by `useCanViewFinOps` — the data shown here is raw API cost, not
     * consumer-priced product cost.
     */
    summary: publicProcedure
      .input(finopsSummaryInput)
      .output(finopsSummary)
      .query(({ ctx, input }) => {
        const repo = getUsageEventRepository(ctx.container);
        const since = input?.since;
        return {
          global: repo.aggregateGlobal(since),
          byWorkload: repo.aggregateByWorkload(since),
          byModel: repo.aggregateByModel(since),
          topNests: repo.topNestsByCost(5, since),
        };
      }),
  }),
});

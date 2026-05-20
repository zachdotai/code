import { z } from "zod";
import type { FeedbackEventRepository } from "../../db/repositories/feedback-event-repository";
import type { OperatorDecisionRepository } from "../../db/repositories/operator-decision-repository";
import type { UsageEventRepository } from "../../db/repositories/usage-event-repository";
import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import {
  FeedbackRoutingEvent,
  type FeedbackRoutingService,
} from "../../services/rts/feedback-routing-service";
import type { GoalSpecDraftService } from "../../services/rts/goal-spec-draft-service";
import type { HedgehogTickService } from "../../services/rts/hedgehog-tick-service";
import type { HogletService } from "../../services/rts/hoglet-service";
import type { NestChatService } from "../../services/rts/nest-chat-service";
import type { NestService } from "../../services/rts/nest-service";
import {
  type PrGraphService,
  PrGraphServiceEvent,
} from "../../services/rts/pr-graph-service";
import { parseNestLoadout } from "../../services/rts/schema-parsers";
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
  RtsEvent,
  hoglet,
  hogletIngestedEventPayload,
  hogletWatchEvent,
  hogletWatchScope,
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
  rebaseChildEventPayload,
  recordAdhocHogletInput,
  recordBootstrapHandoffInput,
  recordRebaseOutcomeInput,
  recordRoutedFeedbackInput,
  recordSignalBackedHogletInput,
  releaseHogletInput,
  retireHogletByTaskIdInput,
  retireHogletInput,
  reviveHogletInput,
  sendNestMessageInput,
  spawnFollowUpHogletInput,
  suppressSignalReportInput,
  unlinkPrDependencyInput,
  updateNestInput,
} from "../../services/rts/schemas";
import {
  SignalIngestionEvent,
  type SignalIngestionService,
} from "../../services/rts/signal-ingestion-service";
import { publicProcedure, router } from "../trpc";

const getService = () => container.get<NestService>(MAIN_TOKENS.NestService);
const getNestChatService = () =>
  container.get<NestChatService>(MAIN_TOKENS.NestChatService);
const getGoalSpecDraftService = () =>
  container.get<GoalSpecDraftService>(MAIN_TOKENS.GoalSpecDraftService);
const getHogletService = () =>
  container.get<HogletService>(MAIN_TOKENS.HogletService);
const getHedgehogTickService = () =>
  container.get<HedgehogTickService>(MAIN_TOKENS.HedgehogTickService);
const getFeedbackRoutingService = () =>
  container.get<FeedbackRoutingService>(MAIN_TOKENS.FeedbackRoutingService);
const getFeedbackEventRepository = () =>
  container.get<FeedbackEventRepository>(MAIN_TOKENS.FeedbackEventRepository);
const getOperatorDecisionRepository = () =>
  container.get<OperatorDecisionRepository>(
    MAIN_TOKENS.OperatorDecisionRepository,
  );
const getPrGraphService = () =>
  container.get<PrGraphService>(MAIN_TOKENS.PrGraphService);
const getSignalIngestionService = () =>
  container.get<SignalIngestionService>(MAIN_TOKENS.SignalIngestionService);
const getUsageEventRepository = () =>
  container.get<UsageEventRepository>(MAIN_TOKENS.UsageEventRepository);

export const rtsRouter = router({
  goalDraft: router({
    respond: publicProcedure
      .input(goalDraftRespondInput)
      .output(goalDraftResponse)
      .mutation(({ input }) => getGoalSpecDraftService().respond(input)),
  }),
  nests: router({
    list: publicProcedure
      .output(listNestsOutput)
      .query(() => getService().list()),

    get: publicProcedure
      .input(nestIdInput)
      .output(nest)
      .query(({ input }) => getService().get(input)),

    create: publicProcedure
      .input(createNestInput)
      .output(nest)
      .mutation(({ input }) => getService().create(input)),

    update: publicProcedure
      .input(updateNestInput)
      .output(nest)
      .mutation(({ input }) => getService().update(input)),

    archive: publicProcedure
      .input(nestIdInput)
      .output(nest)
      .mutation(({ input }) => getService().archive(input)),

    markValidated: publicProcedure
      .input(markValidatedInput)
      .output(nest)
      .mutation(({ input }) => getService().markValidated(input)),

    compact: publicProcedure
      .input(compactValidatedNestInput)
      .output(nest)
      .mutation(({ input }) => getService().compactValidatedNest(input)),

    unarchive: publicProcedure
      .input(nestIdInput)
      .output(nest)
      .mutation(({ input }) => getService().unarchive(input)),

    spawnFollowUpHoglet: publicProcedure
      .input(spawnFollowUpHogletInput)
      .output(hoglet)
      .mutation(async ({ input }) => {
        const nest = getService().get({ id: input.nestId });
        return await getHogletService().spawnFollowUp(
          input,
          parseNestLoadout(nest.loadoutJson),
        );
      }),

    /**
     * Per-nest watch. Emits on status change, archive, and (later) hoglet
     * roster changes / hedgehog tick completion.
     */
    watch: publicProcedure.input(nestIdInput).subscription(async function* ({
      input,
      signal,
    }) {
      const service = getService();
      const iterable = service.toIterable(RtsEvent.NestChanged, {
        signal,
      });
      for await (const data of iterable) {
        if (data.nestId === input.id) {
          yield nestWatchEvent.parse(data.event);
        }
      }
    }),
  }),
  nestChat: router({
    list: publicProcedure
      .input(listNestChatInput)
      .output(listNestChatOutput)
      .query(({ input }) => getNestChatService().list(input)),

    recordBootstrapHandoff: publicProcedure
      .input(recordBootstrapHandoffInput)
      .output(nestMessage)
      .mutation(({ input }) => {
        const message = getNestChatService().recordBootstrapHandoff(input);
        getService().emitMessageAppended(message);
        return message;
      }),

    send: publicProcedure
      .input(sendNestMessageInput)
      .output(nestMessage)
      .mutation(({ input }) => {
        const message = getNestChatService().send(input);
        getService().emitMessageAppended(message);
        // Operator chat is a tick trigger per the spec; fire-and-forget.
        getHedgehogTickService().enqueueTick(input.nestId, "operator_chat");
        return message;
      }),
  }),
  hoglets: router({
    recordAdhoc: publicProcedure
      .input(recordAdhocHogletInput)
      .output(hoglet)
      .mutation(({ input }) => getHogletService().recordAdhoc(input)),

    recordSignalBacked: publicProcedure
      .input(recordSignalBackedHogletInput)
      .output(hoglet)
      .mutation(
        async ({ input }) => await getHogletService().recordSignalBacked(input),
      ),

    adopt: publicProcedure
      .input(adoptHogletInput)
      .output(hoglet)
      .mutation(({ input }) => getHogletService().adopt(input)),

    release: publicProcedure
      .input(releaseHogletInput)
      .output(hoglet)
      .mutation(({ input }) => getHogletService().release(input)),

    dismissSignal: publicProcedure
      .input(dismissSignalHogletInput)
      .output(z.void())
      .mutation(({ input }) => {
        getHogletService().dismissSignal(input);
      }),

    retire: publicProcedure
      .input(retireHogletInput)
      .output(z.void())
      .mutation(({ input }) => {
        getHogletService().retire(input);
      }),

    retireByTaskId: publicProcedure
      .input(retireHogletByTaskIdInput)
      .output(z.void())
      .mutation(({ input }) => {
        getHogletService().retireByTaskId(input.taskId);
      }),

    list: publicProcedure
      .input(listHogletsInput)
      .output(listHogletsOutput)
      .query(({ input }) => getHogletService().list(input)),

    /**
     * Per-scope watch. The map subscribes with `kind: "wild"` for every
     * non-nested hoglet (ad-hoc operator spawns + signal-backed hoglets that
     * the affinity router didn't route into a nest), and each nest's brood
     * cluster subscribes with `kind: "nest", nestId`. The service emits with
     * a `bucket` discriminator that the router matches against the scope.
     */
    watch: publicProcedure
      .input(hogletWatchScope)
      .subscription(async function* ({ input, signal }) {
        const service = getHogletService();
        const iterable = service.toIterable(RtsEvent.HogletChanged, {
          signal,
        });
        for await (const data of iterable) {
          const { bucket } = data;
          if (input.kind === "wild" && bucket.kind === "wild") {
            yield hogletWatchEvent.parse(data.event);
          } else if (
            input.kind === "nest" &&
            bucket.kind === "nest" &&
            bucket.nestId === input.nestId
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
    onInjectPrompt: publicProcedure.subscription(async function* ({ signal }) {
      const service = getFeedbackRoutingService();
      const iterable = service.toIterable(FeedbackRoutingEvent.InjectPrompt, {
        signal,
      });
      for await (const data of iterable) {
        yield data;
      }
    }),

    /** Drains any events emitted before the subscription attached. */
    getPendingInjects: publicProcedure
      .output(z.array(injectPromptEventPayload))
      .query(() => getFeedbackRoutingService().consumePending()),

    /**
     * Records the outcome of a routed feedback event. Inserts a
     * `hedgemony_feedback_event` row (idempotent on the dedupe index)
     * and writes a `feedback_routed` audit row to nest chat.
     */
    recordRouted: publicProcedure
      .input(recordRoutedFeedbackInput)
      .output(feedbackEvent)
      .mutation(({ input }) =>
        getFeedbackRoutingService().recordRoutedOutcome(input),
      ),

    listForNest: publicProcedure
      .input(listFeedbackForNestInput)
      .output(listFeedbackForNestOutput)
      .query(({ input }) =>
        getFeedbackEventRepository().listForNest(input.nestId, input.limit),
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
      .mutation(({ input }) =>
        getOperatorDecisionRepository().recordSuppressSignalReport({
          nestId: input.nestId,
          signalReportId: input.signalReportId,
          reason: input.reason ?? null,
        }),
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
      .mutation(({ input }) =>
        getOperatorDecisionRepository().recordReviveHoglet({
          nestId: input.nestId,
          subjectKey: input.subjectKey,
          reason: input.reason ?? null,
        }),
      ),

    listForNest: publicProcedure
      .input(listOperatorDecisionsInput)
      .output(listOperatorDecisionsOutput)
      .query(({ input }) =>
        getOperatorDecisionRepository().listForNest(input.nestId),
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
      .query(({ input }) => getPrGraphService().listForNest(input.nestId)),

    /** Idempotent edge create. Used by hedgehog tool dispatch and operator UI. */
    link: publicProcedure
      .input(linkPrDependencyInput)
      .output(prDependency)
      .mutation(({ input }) => getPrGraphService().link(input)),

    unlink: publicProcedure
      .input(unlinkPrDependencyInput)
      .mutation(({ input }) => {
        getPrGraphService().unlink(input);
      }),

    /**
     * Per-nest edge watch. Emits on upsert (link or state change) and removed
     * (unlink, cascade-cleanup, dismiss).
     */
    watch: publicProcedure.input(nestIdInput).subscription(async function* ({
      input,
      signal,
    }) {
      const service = getPrGraphService();
      for await (const data of service.toIterable(
        RtsEvent.PrGraphChanged,
        { signal },
      )) {
        if (data.nestId === input.id) {
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
    onRebaseChild: publicProcedure.subscription(async function* ({ signal }) {
      const service = getPrGraphService();
      for await (const data of service.toIterable(
        PrGraphServiceEvent.RebaseChild,
        { signal },
      )) {
        yield data;
      }
    }),

    /** Drains any rebase events emitted before the subscription attached. */
    getPendingRebases: publicProcedure
      .output(z.array(rebaseChildEventPayload))
      .query(() => getPrGraphService().consumePending()),

    /**
     * Records the outcome of a routed rebase event. Writes the edge state
     * transition (`pending → satisfied | broken`) and a
     * `pr_graph_rebase_routed` audit row to nest chat.
     */
    recordRebaseOutcome: publicProcedure
      .input(recordRebaseOutcomeInput)
      .output(prDependency)
      .mutation(({ input }) => getPrGraphService().recordRebaseOutcome(input)),
  }),
  signalIngestion: router({
    /**
     * Idempotent start of the main-side signal ingestion poll loop. The
     * renderer calls this when the Rts map view mounts. The loop
     * survives renderer unmount — only `cancel` (an explicit operator
     * action) stops it.
     */
    start: publicProcedure.output(z.void()).mutation(() => {
      getSignalIngestionService().start();
    }),

    /** Explicit operator override — not invoked on renderer unmount. */
    cancel: publicProcedure.output(z.void()).mutation(() => {
      getSignalIngestionService().cancel();
    }),

    isRunning: publicProcedure
      .output(z.boolean())
      .query(() => getSignalIngestionService().isRunning()),

    /**
     * Live stream of `hogletIngested` events. The renderer subscribes once
     * on map mount to fire analytics + play the arrival voice when a new
     * signal-backed hoglet appears on the map.
     */
    onIngested: publicProcedure.subscription(async function* ({ signal }) {
      const service = getSignalIngestionService();
      const iterable = service.toIterable(SignalIngestionEvent.HogletIngested, {
        signal,
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
      .query(({ input }) => {
        const repo = getUsageEventRepository();
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

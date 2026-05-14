import { z } from "zod";

export const nestStatus = z.enum([
  "active",
  "dormant",
  "archived",
  "needs_attention",
]);
export type NestStatus = z.infer<typeof nestStatus>;

export const nestHealth = z.enum(["ok", "worktree_missing", "db_inconsistent"]);
export type NestHealth = z.infer<typeof nestHealth>;

export const nest = z.object({
  id: z.string(),
  name: z.string(),
  goalPrompt: z.string(),
  definitionOfDone: z.string().nullable(),
  mapX: z.number(),
  mapY: z.number(),
  status: nestStatus,
  health: nestHealth,
  targetMetricId: z.string().nullable(),
  loadoutJson: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Nest = z.infer<typeof nest>;

export const goalDraftTranscriptMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
  kind: z.enum(["message", "question", "spec_proposal"]).optional(),
});
export type GoalDraftTranscriptMessage = z.infer<
  typeof goalDraftTranscriptMessage
>;

export const goalSpecUserStory = z.object({
  priority: z.enum(["P1", "P2", "P3"]),
  story: z.string().trim().min(1),
  acceptanceScenarios: z.array(z.string().trim().min(1)).min(1).max(5),
});

export const goalSpecRequirement = z.object({
  id: z.string().trim().min(1).max(20),
  text: z.string().trim().min(1),
});

export const goalSpecSuccessCriterion = z.object({
  id: z.string().trim().min(1).max(20),
  text: z.string().trim().min(1),
});

export const goalSpecBootstrapContext = z.object({
  mode: z.literal("agent_bootstrap"),
  repositories: z.array(z.string().trim().min(1)).max(10),
  primaryRepository: z.string().trim().min(1).nullable(),
  prompt: z.string().trim().min(1),
  handoffInstructions: z.string().trim().min(1),
  taskId: z.string().trim().min(1).optional(),
});
export type GoalSpecBootstrapContext = z.infer<typeof goalSpecBootstrapContext>;

export const goalSpecDraftCore = z.object({
  name: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1),
  primaryScenario: z.string().trim().min(1),
  userStories: z.array(goalSpecUserStory).min(1).max(6),
  requirements: z.array(goalSpecRequirement).min(1).max(8),
  keyEntities: z.array(z.string().trim().min(1)).max(6),
  assumptions: z.array(z.string().trim().min(1)).max(6),
  successCriteria: z.array(goalSpecSuccessCriterion).min(1).max(6),
  definitionOfDone: z.string().trim().min(1),
});

export const goalSpecDraft = goalSpecDraftCore.extend({
  goalPrompt: z.string().trim().min(1),
  bootstrapContext: goalSpecBootstrapContext.optional(),
});
export type GoalSpecDraft = z.infer<typeof goalSpecDraft>;

export const goalDraftMapContext = z.object({
  mapX: z.number().int().optional(),
  mapY: z.number().int().optional(),
});
export type GoalDraftMapContext = z.infer<typeof goalDraftMapContext>;

export const goalDraftRespondInput = z.object({
  transcript: z.array(goalDraftTranscriptMessage).min(1).max(12),
  currentDraft: goalSpecDraft.optional(),
  mapContext: goalDraftMapContext.optional(),
});
export type GoalDraftRespondInput = z.infer<typeof goalDraftRespondInput>;

export const goalDraftResponse = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ask_question"),
    question: z.string().min(1).max(500),
  }),
  z.object({
    kind: z.literal("propose_spec"),
    draft: goalSpecDraft,
  }),
]);
export type GoalDraftResponse = z.infer<typeof goalDraftResponse>;

export const createNestInput = z.object({
  name: z.string().min(1).max(120),
  goalPrompt: z.string().min(1),
  definitionOfDone: z.string().min(1).nullable().optional(),
  mapX: z.number().int(),
  mapY: z.number().int(),
  creationMode: z.enum(["guided", "simple"]).optional(),
  creationTranscript: z.array(goalDraftTranscriptMessage).max(16).optional(),
  creationBootstrap: goalSpecBootstrapContext.optional(),
});
export type CreateNestInput = z.infer<typeof createNestInput>;

export const updateNestInput = z.object({
  id: z.string(),
  name: z.string().min(1).max(120).optional(),
  goalPrompt: z.string().min(1).optional(),
  definitionOfDone: z.string().min(1).nullable().optional(),
  mapX: z.number().int().optional(),
  mapY: z.number().int().optional(),
  status: nestStatus.optional(),
});
export type UpdateNestInput = z.infer<typeof updateNestInput>;

export const nestIdInput = z.object({ id: z.string() });
export type NestIdInput = z.infer<typeof nestIdInput>;

export const completeNestInput = nestIdInput.extend({
  summary: z.string().trim().min(1).max(8000),
  prUrls: z.array(z.string().trim().min(1)).max(25).optional(),
  taskIds: z.array(z.string().trim().min(1)).max(50).optional(),
  caveats: z.array(z.string().trim().min(1)).max(10).optional(),
});
export type CompleteNestInput = z.infer<typeof completeNestInput>;

export const forgetCompletedNestContextInput = nestIdInput.extend({
  reason: z.string().trim().min(1).max(1000).optional(),
});
export type ForgetCompletedNestContextInput = z.infer<
  typeof forgetCompletedNestContextInput
>;

export const recordBootstrapHandoffInput = z.object({
  nestId: z.string().min(1),
  taskId: z.string().min(1),
  runId: z.string().min(1).optional(),
  repositories: z.array(z.string().trim().min(1)).max(10),
  primaryRepository: z.string().trim().min(1).nullable().optional(),
  handoffMarkdown: z.string().trim().min(1).max(30000),
  outputJson: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type RecordBootstrapHandoffInput = z.infer<
  typeof recordBootstrapHandoffInput
>;

export const listNestsOutput = z.array(nest);

export const nestMessageKind = z.enum([
  "user_message",
  "hedgehog_message",
  "audit",
  "tool_result",
  "hoglet_summary",
]);
export type NestMessageKind = z.infer<typeof nestMessageKind>;

export const nestMessageVisibility = z.enum(["summary", "detail"]);
export type NestMessageVisibility = z.infer<typeof nestMessageVisibility>;

export const nestMessage = z.object({
  id: z.string(),
  nestId: z.string(),
  kind: nestMessageKind,
  visibility: nestMessageVisibility,
  sourceTaskId: z.string().nullable(),
  body: z.string(),
  payloadJson: z.string().nullable(),
  createdAt: z.string(),
});
export type NestMessage = z.infer<typeof nestMessage>;

export const listNestChatInput = z.object({
  nestId: z.string(),
  detail: z.boolean().optional(),
});
export type ListNestChatInput = z.infer<typeof listNestChatInput>;

export const listNestChatOutput = z.array(nestMessage);

/**
 * Renderer-visible projection of `hedgemony_hedgehog_state`. Drives the
 * "ticking" sprite glow and any future per-nest hedgehog UI. `state` enum
 * mirrors the sqlite column.
 */
export const hedgehogStateView = z.object({
  state: z.enum(["idle", "ticking", "proposing_completion"]),
  lastTickAt: z.string().nullable(),
});
export type HedgehogStateView = z.infer<typeof hedgehogStateView>;

/**
 * Discriminated event yielded by `nests.watch(id)`. Status/completed/archived
 * come from `NestService` CRUD; `hedgehog_tick` comes from the tick service;
 * `message_appended` carries newly-written nest chat rows so the renderer
 * doesn't need a separate `nestChat.watch` subscription.
 */
export const nestWatchEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("status"), nest }),
  z.object({ kind: z.literal("completed"), nest }),
  z.object({ kind: z.literal("archived"), nest }),
  z.object({ kind: z.literal("hedgehog_tick"), state: hedgehogStateView }),
  z.object({ kind: z.literal("message_appended"), message: nestMessage }),
]);
export type NestWatchEvent = z.infer<typeof nestWatchEvent>;

export const sendNestMessageInput = z.object({
  nestId: z.string().min(1),
  body: z.string().trim().min(1).max(4000),
});
export type SendNestMessageInput = z.infer<typeof sendNestMessageInput>;

export const hoglet = z.object({
  id: z.string(),
  taskId: z.string(),
  nestId: z.string().nullable(),
  signalReportId: z.string().nullable(),
  /**
   * Cosine similarity (0..1) of the matching nest's goal text against the
   * source signal report's embedding at routing time. Non-null iff the hoglet
   * was placed by the AffinityRouter; cleared on operator adopt/release so
   * the field always reflects current placement provenance, not history.
   */
  affinityScore: z.number().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type Hoglet = z.infer<typeof hoglet>;

export const recordAdhocHogletInput = z.object({
  taskId: z.string().min(1),
});
export type RecordAdhocHogletInput = z.infer<typeof recordAdhocHogletInput>;

export const recordSignalBackedHogletInput = z.object({
  taskId: z.string().min(1),
  signalReportId: z.string().min(1),
});
export type RecordSignalBackedHogletInput = z.infer<
  typeof recordSignalBackedHogletInput
>;

export const adoptHogletInput = z.object({
  hogletId: z.string(),
  nestId: z.string(),
});
export type AdoptHogletInput = z.infer<typeof adoptHogletInput>;

export const releaseHogletInput = z.object({
  hogletId: z.string(),
});
export type ReleaseHogletInput = z.infer<typeof releaseHogletInput>;

export const dismissSignalHogletInput = z.object({
  hogletId: z.string(),
});
export type DismissSignalHogletInput = z.infer<typeof dismissSignalHogletInput>;

export const listHogletsInput = z.object({
  wildOnly: z.boolean().optional(),
  signalStagingOnly: z.boolean().optional(),
  nestId: z.string().optional(),
});
export type ListHogletsInput = z.infer<typeof listHogletsInput>;

export const listHogletsOutput = z.array(hoglet);

export const hogletWatchScope = z.union([
  z.object({ kind: z.literal("wild") }),
  z.object({ kind: z.literal("signal_staging") }),
  z.object({ kind: z.literal("nest"), nestId: z.string() }),
]);
export type HogletWatchScope = z.infer<typeof hogletWatchScope>;

/**
 * Discriminated event yielded by `hoglets.watch`. Future event kinds
 * (e.g. adoption transfers) join this union when the relevant slices land.
 */
export const hogletWatchEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("upsert"), hoglet }),
  z.object({ kind: z.literal("removed"), hogletId: z.string() }),
]);
export type HogletWatchEvent = z.infer<typeof hogletWatchEvent>;

export const feedbackEventSource = z.enum(["pr_review", "ci", "issue"]);
export type FeedbackEventSource = z.infer<typeof feedbackEventSource>;

export const feedbackEventOutcome = z.enum([
  "injected",
  "follow_up_spawned",
  "failed",
]);
export type FeedbackEventOutcome = z.infer<typeof feedbackEventOutcome>;

export const feedbackTrustTier = z.enum(["operator", "internal", "external"]);
export type FeedbackTrustTier = z.infer<typeof feedbackTrustTier>;

export const feedbackEvent = z.object({
  id: z.string(),
  nestId: z.string().nullable(),
  hogletTaskId: z.string(),
  source: feedbackEventSource,
  payloadHash: z.string(),
  payloadRef: z.string(),
  trustTier: feedbackTrustTier,
  routedOutcome: feedbackEventOutcome,
  injectedAt: z.string(),
});
export type FeedbackEvent = z.infer<typeof feedbackEvent>;

export const injectPromptEventPayload = z.object({
  taskId: z.string(),
  hogletId: z.string(),
  nestId: z.string().nullable(),
  source: feedbackEventSource,
  payloadRef: z.string(),
  payloadHash: z.string(),
  prompt: z.string(),
  prUrl: z.string(),
  fallbackPrompt: z.string(),
});
export type InjectPromptEventPayload = z.infer<typeof injectPromptEventPayload>;

export const recordRoutedFeedbackInput = z.object({
  nestId: z.string().nullable(),
  hogletTaskId: z.string(),
  source: feedbackEventSource,
  payloadHash: z.string(),
  payloadRef: z.string(),
  routedOutcome: feedbackEventOutcome,
  trustTier: feedbackTrustTier.optional(),
});
export type RecordRoutedFeedbackInput = z.infer<
  typeof recordRoutedFeedbackInput
>;

export const spawnFollowUpHogletInput = z.object({
  nestId: z.string().min(1),
  parentTaskId: z.string().min(1),
  prompt: z.string().min(1).max(8000),
  payloadRef: z.string().min(1),
});
export type SpawnFollowUpHogletInput = z.infer<typeof spawnFollowUpHogletInput>;

export const listFeedbackForNestInput = z.object({
  nestId: z.string(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type ListFeedbackForNestInput = z.infer<typeof listFeedbackForNestInput>;

export const listFeedbackForNestOutput = z.array(feedbackEvent);

export const HedgemonyEvent = {
  NestChanged: "nest-changed",
  HogletChanged: "hoglet-changed",
} as const;

/**
 * Internal service-bus event. `nestId` is the partition key the router uses
 * to filter for per-nest subscriptions.
 */
export interface NestChangedEvent {
  nestId: string;
  event: NestWatchEvent;
}

/**
 * Bucket partition for hoglet watch events. Wild = `nest_id IS NULL AND
 * signal_report_id IS NULL`; signal_staging = `nest_id IS NULL AND
 * signal_report_id IS NOT NULL`; nest = adopted into a specific nest. The
 * router filters subscriptions by matching the bucket against the watch scope.
 */
export type HogletBucket =
  | { kind: "wild" }
  | { kind: "signal_staging" }
  | { kind: "nest"; nestId: string };

/**
 * Internal service-bus event for hoglet roster changes. `bucket` identifies
 * the destination/origin partition so the tRPC router can route to the
 * matching watcher (`wild` / `signal_staging` / `nest:<id>`).
 */
export interface HogletChangedEvent {
  bucket: HogletBucket;
  event: HogletWatchEvent;
}

export interface HedgemonyEvents {
  [HedgemonyEvent.NestChanged]: NestChangedEvent;
  [HedgemonyEvent.HogletChanged]: HogletChangedEvent;
}

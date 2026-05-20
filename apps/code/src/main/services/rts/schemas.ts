import type { TaskRunStatus } from "@shared/types";
import { z } from "zod";

const taskRunStatusValues = [
  "not_started",
  "queued",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
] as const satisfies readonly TaskRunStatus[];
export const taskRunStatusEnum = z.enum(taskRunStatusValues);

export const HOGLET_PROMPT_MAX_CHARS = 32_000;

/**
 * GitHub-style repository slug. Matches what `parseGithubUrl` produces:
 * `owner/repo` with each segment limited to GitHub's allowed character set.
 * Used everywhere a repository identifier is stored or transmitted.
 */
export const repoSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(140)
  .regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, {
    message: "must look like owner/repo with safe characters only",
  });

/**
 * Model identifiers we trust to be passed verbatim to the cloud task API.
 * Keep the regex permissive enough for vendor-specific model strings
 * (`claude-opus-4-7`, `gpt-5.5`, `claude-sonnet-4-6-20251001`) but reject
 * paths, URLs, shell metacharacters, and unbounded growth.
 */
export const modelIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, {
    message:
      "model identifier may only contain alphanum, dot, dash, colon, underscore",
  });

/**
 * Execution modes that can be persisted into the per-nest loadout or read
 * back from settings-storage. Tighter than `executionModeSchema`:
 * `bypassPermissions` is excluded so a tampered `loadoutJson` row cannot
 * silently disable per-tool approvals for every hoglet spawned from a nest.
 * Hedgemony may still choose a bypassing default internally for autonomous
 * background hoglets.
 */
export const persistedExecutionModeSchema = z.enum([
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "read-only",
  "full-access",
]);
export type PersistedExecutionMode = z.infer<
  typeof persistedExecutionModeSchema
>;

/**
 * Nest lifecycle status. `validated` is a terminal-but-queryable state the
 * operator confirms when the goal is met; the follow-up `compact` action then
 * transitions a `validated` nest to `dormant`, trimming the chat to a bounded
 * summary. `archived` is independent of the validation track (operator
 * cancels/buries the nest).
 */
export const nestStatus = z.enum([
  "active",
  "validated",
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
  primaryRepository: z.string().nullable(),
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

/**
 * Identifier shape for nests and hoglets. Stored as UUIDv7 strings; we accept
 * any 36-char UUID-ish so older rows still parse but reject unbounded strings
 * and shell metacharacters.
 */
export const hedgemonyIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._-]+$/);

export const nestIdInput = z.object({ id: hedgemonyIdSchema });
export type NestIdInput = z.infer<typeof nestIdInput>;

export const markValidatedInput = nestIdInput.extend({
  summary: z.string().trim().min(1).max(8000),
  prUrls: z.array(z.string().trim().min(1)).max(25).optional(),
  taskIds: z.array(z.string().trim().min(1)).max(50).optional(),
  caveats: z.array(z.string().trim().min(1)).max(10).optional(),
});
export type MarkValidatedInput = z.infer<typeof markValidatedInput>;

export const compactValidatedNestInput = nestIdInput.extend({
  reason: z.string().trim().min(1).max(1000).optional(),
});
export type CompactValidatedNestInput = z.infer<
  typeof compactValidatedNestInput
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
  "hoglet_message",
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
 * Discriminated event yielded by `nests.watch(id)`. Status/validated/archived
 * come from `NestService` CRUD; `hedgehog_tick` comes from the tick service;
 * `message_appended` carries newly-written nest chat rows so the renderer
 * doesn't need a separate `nestChat.watch` subscription. `validated` fires
 * when the operator confirms goal completion; the subsequent compaction
 * (`validated` → `dormant`) emits another `status` event.
 */
export const nestWatchEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("status"), nest }),
  z.object({ kind: z.literal("validated"), nest }),
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
  name: z.string().nullable(),
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

export const hedgemonyReasoningEffort = z.enum([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
export type HedgemonyReasoningEffort = z.infer<typeof hedgemonyReasoningEffort>;

export const hogletRuntimeAdapter = z.enum(["claude", "codex"]);
export type HogletRuntimeAdapter = z.infer<typeof hogletRuntimeAdapter>;

export const nestLoadout = z.object({
  model: modelIdentifierSchema.optional(),
  runtimeAdapter: hogletRuntimeAdapter.optional(),
  reasoningEffort: hedgemonyReasoningEffort.optional(),
  executionMode: persistedExecutionModeSchema.optional(),
  environment: z.enum(["local", "cloud"]).optional(),
  heartbeatIntervalMs: z.number().int().min(60_000).max(600_000).optional(),
  budgetUsd: z.number().nonnegative().optional(),
  perHogletBudgetUsd: z.number().nonnegative().optional(),
});
export type NestLoadout = z.infer<typeof nestLoadout>;

/**
 * Validates a single `ScratchpadEntry` (defined structurally in
 * `hedgehog-prompts.ts`). Kept here so the schema and the parser live next
 * to each other.
 */
export const scratchpadEntrySchema = z.object({
  ts: z.string().min(1).max(64),
  kind: z.enum(["decision", "observation", "note"]),
  summary: z.string().min(1).max(1000),
});

export const holdNextTrigger = z.enum([
  "operator_response",
  "hoglet_output",
  "pr_status_change",
  "timeout",
]);
export type HoldNextTrigger = z.infer<typeof holdNextTrigger>;

export const activeHoldStateSchema = z.object({
  reason: z.string().min(1).max(200),
  nextTrigger: holdNextTrigger,
  timeoutSeconds: z.number().int().positive().optional(),
  createdAt: z.string().min(1).max(64),
  timeoutAt: z.string().min(1).max(64).optional(),
  lastOperatorMessageAt: z.string().nullable().optional(),
  lastHogletOutputAt: z.string().nullable().optional(),
  prStatusFingerprint: z.string().nullable().optional(),
});
export type ActiveHoldState = z.infer<typeof activeHoldStateSchema>;

/**
 * Top-level shape of `hedgemony_hedgehog_state.serializedStateJson`. Anything
 * outside this shape is dropped to keep adversarial entries out of the next
 * hedgehog prompt.
 */
export const scratchpadStateSchema = z.object({
  scratchpad: z.array(scratchpadEntrySchema).max(200).optional(),
  observedTerminalRunKeys: z.record(z.string(), z.string().max(512)).optional(),
  activeHold: activeHoldStateSchema.nullable().optional(),
});

/**
 * Shape of the `payloadJson` row written by nest creation when bootstrap
 * context exists. `deriveRepositoryContext` reads this on every tick to know
 * which repositories the hedgehog can spawn into.
 */
export const nestChatCreationBootstrapPayloadSchema = z.object({
  type: z.string().optional(),
  creationBootstrap: z
    .object({
      repositories: z.array(repoSlugSchema).max(10).optional(),
      primaryRepository: repoSlugSchema.nullable().optional(),
    })
    .optional(),
  repositories: z.array(repoSlugSchema).max(10).optional(),
  primaryRepository: repoSlugSchema.nullable().optional(),
});
export type NestChatCreationBootstrapPayload = z.infer<
  typeof nestChatCreationBootstrapPayloadSchema
>;

export function parseNestChatCreationBootstrapPayload(
  payloadJson: string | null,
): NestChatCreationBootstrapPayload | null {
  if (!payloadJson) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  const result = nestChatCreationBootstrapPayloadSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export const DEFAULT_HOGLET_MODEL = "claude-opus-4-7";
export const DEFAULT_CODEX_HOGLET_MODEL = "gpt-5.5";
export const DEFAULT_HOGLET_RUNTIME_ADAPTER = "claude" as const;
export const DEFAULT_HOGLET_ENVIRONMENT = "cloud" as const;
export const DEFAULT_CLAUDE_REASONING_EFFORT: HedgemonyReasoningEffort = "max";
export const DEFAULT_CODEX_REASONING_EFFORT: HedgemonyReasoningEffort = "high";

export function defaultModelForAdapter(
  adapter: HogletRuntimeAdapter | undefined,
): string {
  return adapter === "codex"
    ? DEFAULT_CODEX_HOGLET_MODEL
    : DEFAULT_HOGLET_MODEL;
}

export function defaultReasoningEffortForAdapter(
  adapter: HogletRuntimeAdapter | undefined,
): HedgemonyReasoningEffort {
  return adapter === "codex"
    ? DEFAULT_CODEX_REASONING_EFFORT
    : DEFAULT_CLAUDE_REASONING_EFFORT;
}

const CODEX_MAX_EFFORT: HedgemonyReasoningEffort = "high";

export function clampReasoningEffortForAdapter(
  effort: HedgemonyReasoningEffort,
  adapter: HogletRuntimeAdapter | undefined,
): HedgemonyReasoningEffort {
  if (adapter !== "codex") return effort;
  const order: HedgemonyReasoningEffort[] = [
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ];
  const effortIdx = order.indexOf(effort);
  const maxIdx = order.indexOf(CODEX_MAX_EFFORT);
  return effortIdx > maxIdx ? CODEX_MAX_EFFORT : effort;
}

export const spawnHogletInNestInput = z.object({
  nestId: z.string().min(1),
  prompt: z.string().min(1).max(HOGLET_PROMPT_MAX_CHARS),
  repository: z.string().trim().min(1).optional(),
});
export type SpawnHogletInNestInput = z.infer<typeof spawnHogletInNestInput>;

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
  hogletId: hedgemonyIdSchema,
  nestId: hedgemonyIdSchema,
});
export type AdoptHogletInput = z.infer<typeof adoptHogletInput>;

export const releaseHogletInput = z.object({
  hogletId: hedgemonyIdSchema,
});
export type ReleaseHogletInput = z.infer<typeof releaseHogletInput>;

export const dismissSignalHogletInput = z.object({
  hogletId: hedgemonyIdSchema,
});
export type DismissSignalHogletInput = z.infer<typeof dismissSignalHogletInput>;

export const retireHogletInput = z.object({
  hogletId: hedgemonyIdSchema,
});
export type RetireHogletInput = z.infer<typeof retireHogletInput>;

export const retireHogletByTaskIdInput = z.object({
  taskId: z.string().trim().min(1).max(64),
});
export type RetireHogletByTaskIdInput = z.infer<
  typeof retireHogletByTaskIdInput
>;

export const listHogletsInput = z.object({
  wildOnly: z.boolean().optional(),
  nestId: z.string().optional(),
});
export type ListHogletsInput = z.infer<typeof listHogletsInput>;

export const listHogletsOutput = z.array(hoglet);

export const hogletWatchScope = z.union([
  z.object({ kind: z.literal("wild") }),
  z.object({ kind: z.literal("nest"), nestId: z.string() }),
]);
export type HogletWatchScope = z.infer<typeof hogletWatchScope>;

export const hogletIngestedEventPayload = z.object({
  signalReportId: z.string().min(1),
  taskId: z.string().min(1),
  hogletId: z.string().min(1),
});
export type HogletIngestedEventPayload = z.infer<
  typeof hogletIngestedEventPayload
>;

/**
 * Discriminated event yielded by `hoglets.watch`. Future event kinds
 * (e.g. adoption transfers) join this union when the relevant slices land.
 */
export const hogletWatchEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("upsert"), hoglet }),
  z.object({ kind: z.literal("removed"), hogletId: z.string() }),
]);
export type HogletWatchEvent = z.infer<typeof hogletWatchEvent>;

export const feedbackEventSource = z.enum([
  "pr_review",
  "ci",
  "issue",
  "hedgehog",
]);
export type FeedbackEventSource = z.infer<typeof feedbackEventSource>;

/**
 * The outcome value stored on a `hedgemony_feedback_event` row. `pending` is
 * the reservation state the router writes before emitting; once the renderer
 * records the routing outcome it flips to one of the terminal values.
 */
export const feedbackEventOutcome = z.enum([
  "pending",
  "injected",
  "follow_up_spawned",
  "failed",
]);
export type FeedbackEventOutcome = z.infer<typeof feedbackEventOutcome>;

export const feedbackProcessingState = z.enum(["active", "queued", "unknown"]);
export type FeedbackProcessingState = z.infer<typeof feedbackProcessingState>;

/**
 * Outcomes the renderer is allowed to commit via `recordRoutedOutcome`.
 * Excludes `pending`, which is router-internal.
 */
export const recordedFeedbackOutcome = z.enum([
  "injected",
  "follow_up_spawned",
  "failed",
]);
export type RecordedFeedbackOutcome = z.infer<typeof recordedFeedbackOutcome>;

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
  processed: feedbackProcessingState,
  injectedAt: z.string(),
});
export type FeedbackEvent = z.infer<typeof feedbackEvent>;

export const injectPromptEventPayload = z.object({
  taskId: z.string().min(1).max(64),
  hogletId: z.string().min(1).max(64),
  nestId: z.string().min(1).max(64).nullable(),
  source: feedbackEventSource,
  targetRunStatus: taskRunStatusEnum.nullable().optional(),
  payloadRef: z.string().min(1).max(512),
  payloadHash: z.string().min(1).max(128),
  prompt: z.string().max(HOGLET_PROMPT_MAX_CHARS),
  prUrl: z.string().max(512),
  fallbackPrompt: z.string().max(HOGLET_PROMPT_MAX_CHARS),
});
export type InjectPromptEventPayload = z.infer<typeof injectPromptEventPayload>;

export const recordRoutedFeedbackInput = z.object({
  nestId: z.string().nullable(),
  hogletTaskId: z.string(),
  source: feedbackEventSource,
  payloadHash: z.string(),
  payloadRef: z.string(),
  routedOutcome: recordedFeedbackOutcome,
  processed: feedbackProcessingState.optional(),
  trustTier: feedbackTrustTier.optional(),
});
export type RecordRoutedFeedbackInput = z.infer<
  typeof recordRoutedFeedbackInput
>;

export const spawnFollowUpHogletInput = z.object({
  nestId: z.string().min(1),
  parentTaskId: z.string().min(1),
  prompt: z.string().min(1).max(HOGLET_PROMPT_MAX_CHARS),
  payloadRef: z.string().min(1),
});
export type SpawnFollowUpHogletInput = z.infer<typeof spawnFollowUpHogletInput>;

export const listFeedbackForNestInput = z.object({
  nestId: z.string(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type ListFeedbackForNestInput = z.infer<typeof listFeedbackForNestInput>;

export const listFeedbackForNestOutput = z.array(feedbackEvent);

/**
 * The operator override memory. When the operator manually undoes the
 * hedgehog's decision (revives a killed hoglet, suppresses a signal report
 * that the hedgehog kept respawning), we persist a row so the next tick
 * doesn't whack the same mole. Kinds are extensible — add new entries as we
 * find more "do-not-redo this" decisions worth remembering.
 */
export const operatorDecisionKind = z.enum([
  "suppress_signal_report",
  "revive_hoglet",
]);
export type OperatorDecisionKind = z.infer<typeof operatorDecisionKind>;

export const operatorDecision = z.object({
  id: z.string(),
  nestId: z.string(),
  kind: operatorDecisionKind,
  subjectKey: z.string(),
  reason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OperatorDecision = z.infer<typeof operatorDecision>;

export const suppressSignalReportInput = z.object({
  nestId: z.string().min(1),
  signalReportId: z.string().min(1),
  reason: z.string().trim().min(1).max(2000).optional(),
});
export type SuppressSignalReportInput = z.infer<
  typeof suppressSignalReportInput
>;

export const reviveHogletInput = z.object({
  nestId: z.string().min(1),
  subjectKey: z.string().min(1),
  reason: z.string().trim().min(1).max(2000).optional(),
});
export type ReviveHogletInput = z.infer<typeof reviveHogletInput>;

export const listOperatorDecisionsInput = z.object({
  nestId: z.string().min(1),
});
export type ListOperatorDecisionsInput = z.infer<
  typeof listOperatorDecisionsInput
>;

export const listOperatorDecisionsOutput = z.array(operatorDecision);

export const prDependencyState = z.enum([
  "pending",
  "satisfied",
  "broken",
  "follow_up",
]);
export type PrDependencyStateValue = z.infer<typeof prDependencyState>;

export const prDependency = z.object({
  id: z.string(),
  nestId: z.string(),
  parentTaskId: z.string(),
  childTaskId: z.string(),
  state: prDependencyState,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PrDependencyView = z.infer<typeof prDependency>;

export const linkPrDependencyInput = z.object({
  nestId: z.string().min(1),
  parentTaskId: z.string().min(1),
  childTaskId: z.string().min(1),
});
export type LinkPrDependencyInput = z.infer<typeof linkPrDependencyInput>;

export const unlinkPrDependencyInput = z.object({
  id: z.string().min(1),
});
export type UnlinkPrDependencyInput = z.infer<typeof unlinkPrDependencyInput>;

export const listPrDependenciesForNestInput = z.object({
  nestId: z.string().min(1),
});
export type ListPrDependenciesForNestInput = z.infer<
  typeof listPrDependenciesForNestInput
>;

export const listPrDependenciesForNestOutput = z.array(prDependency);

export const rebaseChildEventPayload = z.object({
  edgeId: z.string(),
  nestId: z.string(),
  parentTaskId: z.string(),
  childTaskId: z.string(),
  childHogletId: z.string(),
  parentPrUrl: z.string(),
  parentBranch: z.string().nullable(),
  prompt: z.string(),
  fallbackPrompt: z.string(),
});
export type RebaseChildEventPayload = z.infer<typeof rebaseChildEventPayload>;

export const rebaseOutcome = z.enum([
  "injected",
  "follow_up_spawned",
  "failed",
  "broken",
]);
export type RebaseOutcome = z.infer<typeof rebaseOutcome>;

export const recordRebaseOutcomeInput = z.object({
  edgeId: z.string().min(1),
  outcome: rebaseOutcome,
  note: z.string().trim().min(1).max(2000).optional(),
});
export type RecordRebaseOutcomeInput = z.infer<typeof recordRebaseOutcomeInput>;

/**
 * Per-nest PR-graph watch event. Mirrors `hogletWatchEvent` shape — flat with
 * a `kind` discriminator — so renderer subscriptions can react to edge
 * upserts and removals identically.
 */
export const prGraphWatchEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("upsert"), edge: prDependency }),
  z.object({ kind: z.literal("removed"), edgeId: z.string() }),
]);
export type PrGraphWatchEvent = z.infer<typeof prGraphWatchEvent>;

export const usageWorkload = z.enum([
  "hedgehog-tick",
  "brood-hoglet",
  "wild-hoglet",
]);
export type UsageWorkloadValue = z.infer<typeof usageWorkload>;

export const aggregateRow = z.object({
  totalInputTokens: z.number(),
  totalOutputTokens: z.number(),
  totalCacheReadTokens: z.number(),
  totalCacheCreationTokens: z.number(),
  totalCostUsd: z.number(),
  eventCount: z.number(),
});
export type AggregateRowValue = z.infer<typeof aggregateRow>;

export const finopsSummaryInput = z
  .object({
    since: z.string().datetime().optional(),
  })
  .optional();
export type FinopsSummaryInput = z.infer<typeof finopsSummaryInput>;

export const finopsSummary = z.object({
  global: aggregateRow,
  byWorkload: z.array(
    z.object({
      workload: usageWorkload,
      row: aggregateRow,
    }),
  ),
  byModel: z.array(
    z.object({
      model: z.string(),
      row: aggregateRow,
    }),
  ),
  topNests: z.array(
    z.object({
      nestId: z.string(),
      row: aggregateRow,
    }),
  ),
});
export type FinopsSummary = z.infer<typeof finopsSummary>;

export const HedgemonyEvent = {
  NestChanged: "nest-changed",
  HogletChanged: "hoglet-changed",
  PrGraphChanged: "pr-graph-changed",
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
 * Bucket partition for hoglet watch events. Wild = `nest_id IS NULL`
 * (regardless of `signal_report_id`); nest = adopted into a specific nest.
 * The router filters subscriptions by matching the bucket against the watch
 * scope. Signal-backed hoglets that the affinity router doesn't auto-route
 * land in `wild` alongside operator-spawned ad-hoc work.
 */
export type HogletBucket = { kind: "wild" } | { kind: "nest"; nestId: string };

/**
 * Internal service-bus event for hoglet roster changes. `bucket` identifies
 * the destination/origin partition so the tRPC router can route to the
 * matching watcher (`wild` / `nest:<id>`).
 */
export interface HogletChangedEvent {
  bucket: HogletBucket;
  event: HogletWatchEvent;
}

/**
 * Internal service-bus event for PR-graph edge changes. The router filters
 * subscriptions by `nestId` so per-nest watchers only see their own edges.
 */
export interface PrGraphChangedEvent {
  nestId: string;
  event: PrGraphWatchEvent;
}

export interface HedgemonyEvents {
  [HedgemonyEvent.NestChanged]: NestChangedEvent;
  [HedgemonyEvent.HogletChanged]: HogletChangedEvent;
  [HedgemonyEvent.PrGraphChanged]: PrGraphChangedEvent;
}

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
 * Discriminated event yielded by `nests.watch(id)`. Future event kinds
 * (hoglet roster changes, hedgehog tick completion) join this union as the
 * relevant services come online.
 */
export const nestWatchEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("status"), nest }),
  z.object({ kind: z.literal("archived"), nest }),
]);
export type NestWatchEvent = z.infer<typeof nestWatchEvent>;

export const hoglet = z.object({
  id: z.string(),
  taskId: z.string(),
  nestId: z.string().nullable(),
  signalReportId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type Hoglet = z.infer<typeof hoglet>;

export const recordAdhocHogletInput = z.object({
  taskId: z.string().min(1),
});
export type RecordAdhocHogletInput = z.infer<typeof recordAdhocHogletInput>;

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

/**
 * Discriminated event yielded by `hoglets.watch`. Future event kinds
 * (e.g. adoption transfers) join this union when the relevant slices land.
 */
export const hogletWatchEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("upsert"), hoglet }),
  z.object({ kind: z.literal("removed"), hogletId: z.string() }),
]);
export type HogletWatchEvent = z.infer<typeof hogletWatchEvent>;

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
 * Internal service-bus event for hoglet roster changes. `nestId = null`
 * means the hoglet is wild (no nest, no signal report).
 */
export interface HogletChangedEvent {
  nestId: string | null;
  event: HogletWatchEvent;
}

export interface HedgemonyEvents {
  [HedgemonyEvent.NestChanged]: NestChangedEvent;
  [HedgemonyEvent.HogletChanged]: HogletChangedEvent;
}

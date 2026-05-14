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

export const createNestInput = z.object({
  name: z.string().min(1).max(120),
  goalPrompt: z.string().min(1),
  definitionOfDone: z.string().min(1).nullable().optional(),
  mapX: z.number().int(),
  mapY: z.number().int(),
  creationMode: z.enum(["guided", "simple"]).optional(),
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

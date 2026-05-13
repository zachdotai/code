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
  mapX: z.number().int(),
  mapY: z.number().int(),
});
export type CreateNestInput = z.infer<typeof createNestInput>;

export const updateNestInput = z.object({
  id: z.string(),
  name: z.string().min(1).max(120).optional(),
  goalPrompt: z.string().min(1).optional(),
  mapX: z.number().int().optional(),
  mapY: z.number().int().optional(),
  status: nestStatus.optional(),
});
export type UpdateNestInput = z.infer<typeof updateNestInput>;

export const nestIdInput = z.object({ id: z.string() });
export type NestIdInput = z.infer<typeof nestIdInput>;

export const listNestsOutput = z.array(nest);

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

export const HedgemonyEvent = {
  NestChanged: "nest-changed",
} as const;

/**
 * Internal service-bus event. `nestId` is the partition key the router uses
 * to filter for per-nest subscriptions.
 */
export interface NestChangedEvent {
  nestId: string;
  event: NestWatchEvent;
}

export interface HedgemonyEvents {
  [HedgemonyEvent.NestChanged]: NestChangedEvent;
}

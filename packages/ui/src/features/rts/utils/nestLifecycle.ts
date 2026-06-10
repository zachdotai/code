import type { Hoglet, Nest } from "@posthog/host-router/rts-schemas";
import type { TaskStatus } from "../components/hogletStatus";

/**
 * Renderer-facing lifecycle states for a nest. Derived purely from data the
 * renderer already has (nest.status + the hoglet roster + per-hoglet task
 * status), so the hedgehog needs no special "propose completion" tool. The
 * sprite + detail panel render these directly.
 *
 *   planning   — fresh nest, no hoglets yet
 *   working    — at least one hoglet still doing work
 *   validating — all hoglets terminal, definition of done set → operator
 *                review surface lights up
 *   validated  — operator confirmed validation; nest queryable in full detail
 *   dormant    — validated nest was compacted; chat trimmed to a summary
 *   archived   — cancelled / buried; independent of the validation track
 */
export type NestLifecycle =
  | "planning"
  | "working"
  | "validating"
  | "validated"
  | "dormant"
  | "archived";

const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  "completed",
  "failed",
  "cancelled",
]);

export interface DeriveNestLifecycleArgs {
  nest: Pick<Nest, "status" | "definitionOfDone">;
  hoglets: ReadonlyArray<Pick<Hoglet, "id" | "taskId">>;
  taskStatusFor: (taskId: string) => TaskStatus;
}

export function deriveNestLifecycle({
  nest,
  hoglets,
  taskStatusFor,
}: DeriveNestLifecycleArgs): NestLifecycle {
  if (nest.status === "archived") return "archived";
  if (nest.status === "dormant") return "dormant";
  if (nest.status === "validated") return "validated";

  // nest.status === "active" | "needs_attention" from here. We treat
  // needs_attention as a working substate for lifecycle purposes — the badge
  // surface conveys that orthogonally to the goal-validation track.

  if (hoglets.length === 0) return "planning";

  const allTerminal = hoglets.every((h) =>
    TERMINAL_STATUSES.has(taskStatusFor(h.taskId)),
  );
  if (!allTerminal) return "working";

  if (!nest.definitionOfDone) return "working";

  return "validating";
}

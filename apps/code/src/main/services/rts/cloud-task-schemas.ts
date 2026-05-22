import type { DismissalReasonOptionValue } from "@shared/dismissalReasons";
import { DISMISSAL_REASON_OPTIONS } from "@shared/dismissalReasons";
import type {
  ActionabilityJudgmentArtefact,
  DismissalArtefact,
  PriorityJudgmentArtefact,
  SignalFindingArtefact,
  SignalReport,
  SignalReportArtefact,
  SignalReportArtefactsResponse,
  SuggestedReviewersArtefact,
  Task,
  TaskRun,
  TaskRunStatus,
} from "@shared/types";
import type { StoredLogEntry } from "@shared/types/session-events";
import { z } from "zod";

/**
 * Schemas for the PostHog cloud task API responses consumed by
 * `CloudTaskClient`. Kept in their own file so the client stays focused on
 * the HTTP dance and the shape definitions stay close enough to read
 * end-to-end.
 *
 * Each public schema is paired with a `satisfies z.ZodType<...>` assertion
 * that pins the inferred output to the shared TS type — if the renderer
 * shape drifts from the cloud shape the build fails here rather than at
 * every call site that used to lean on `as unknown as Task`.
 */

/**
 * `pr_url` validator applied to the `task_run.output.pr_url` field when
 * present. Used as a structural refinement on the parent `output` schema so
 * the inferred type stays `Record<string, unknown>` (matching the shared
 * `TaskRun.output` shape).
 */
function isAllowedGithubPrUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 512) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    return url.host === "github.com" || url.host.endsWith(".github.com");
  } catch {
    return false;
  }
}

const taskRunOutputSchema = z
  .record(z.string(), z.unknown())
  .nullable()
  .refine((output) => {
    if (output == null) return true;
    const prUrl = output.pr_url;
    if (prUrl == null) return true;
    return isAllowedGithubPrUrl(prUrl);
  }, "pr_url must be an https URL on github.com");

const branchSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._\-/]+$/);

const taskRunStatusValues = [
  "not_started",
  "queued",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
] as const satisfies readonly TaskRunStatus[];
const taskRunStatusSchema = z.enum(taskRunStatusValues);

const taskRunRuntimeAdapterSchema = z.enum(["claude", "codex"]);
const taskRunReasoningEffortSchema = z.enum([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
const taskRunEnvironmentSchema = z.enum(["local", "cloud"]);

const userBasicSchema = z
  .object({
    id: z.number(),
    uuid: z.string(),
    distinct_id: z.string().nullable().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    email: z.string(),
    is_email_verified: z.boolean().nullable().optional(),
  })
  .passthrough();

/**
 * Validates a `TaskRun` row returned by the cloud. Required fields are
 * required so the parser fails fast on shapes that would have produced
 * `undefined` field reads downstream. `output` and `state` use
 * `Record<string, unknown>` semantics through `.passthrough()`.
 */
export const taskRunSchema = z
  .object({
    id: z.string().min(1).max(64),
    task: z.string().min(1).max(64),
    team: z.number(),
    branch: branchSchema.nullable(),
    runtime_adapter: taskRunRuntimeAdapterSchema.nullable().optional(),
    model: z.string().nullable().optional(),
    reasoning_effort: taskRunReasoningEffortSchema.nullable().optional(),
    stage: z.string().nullable().optional(),
    environment: taskRunEnvironmentSchema.optional(),
    status: taskRunStatusSchema,
    log_url: z.string(),
    error_message: z.string().nullable(),
    output: taskRunOutputSchema,
    state: z.record(z.string(), z.unknown()),
    created_at: z.string(),
    updated_at: z.string(),
    completed_at: z.string().nullable(),
  })
  .passthrough() satisfies z.ZodType<TaskRun>;

/**
 * `latest_run` on a Task response. The cloud may return either a full
 * `TaskRun` shape or `null` (e.g. when a Task has been created but never
 * run). We need a separate, looser schema for `latest_run` because the
 * cloud's serializer for the nested run can drop fields the top-level
 * `/runs/` endpoint always includes — and the `Task.latest_run` field in
 * `@shared/types` is `TaskRun | undefined`, not the full TaskRun.
 *
 * We intentionally accept the same shape as `taskRunSchema` here.
 */
const taskRunNestedSchema = taskRunSchema;

/**
 * Validates a Task row returned by the cloud. Mirrors the shared `Task`
 * interface field-for-field so the parser output is directly assignable —
 * no `as unknown as Task` cast required at the call site.
 *
 * `latest_run` is coerced from the cloud's `TaskRun | null` to the shared
 * type's `TaskRun | undefined` so consumers can keep their existing
 * `task.latest_run ?? null` access pattern without zod widening the union.
 */
export const taskSchema = z
  .object({
    id: z.string().min(1).max(64),
    task_number: z.number().nullable(),
    slug: z.string(),
    title: z.string(),
    title_manually_set: z.boolean().optional(),
    description: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    created_by: userBasicSchema.nullable().optional(),
    origin_product: z.string(),
    repository: z.string().nullable().optional(),
    github_integration: z.number().nullable().optional(),
    github_user_integration: z.string().nullable().optional(),
    json_schema: z.record(z.string(), z.unknown()).nullable().optional(),
    signal_report: z.string().nullable().optional(),
    internal: z.boolean().optional(),
    latest_run: taskRunNestedSchema
      .nullable()
      .optional()
      .transform((value) => value ?? undefined),
  })
  .passthrough() satisfies z.ZodType<Task>;

const signalReportStatusSchema = z.enum([
  "potential",
  "candidate",
  "in_progress",
  "ready",
  "failed",
  "pending_input",
  "suppressed",
  "deleted",
]);

const signalReportPrioritySchema = z.enum(["P0", "P1", "P2", "P3", "P4"]);

const signalReportActionabilitySchema = z.enum([
  "immediately_actionable",
  "requires_human_input",
  "not_actionable",
]);

const signalReportSchema = z
  .object({
    id: z.string().min(1).max(128),
    title: z.string().nullable(),
    summary: z.string().nullable(),
    status: signalReportStatusSchema,
    total_weight: z.number(),
    signal_count: z.number(),
    signals_at_run: z.number().optional(),
    created_at: z.string(),
    updated_at: z.string(),
    artefact_count: z.number(),
    priority: signalReportPrioritySchema.nullable().optional(),
    actionability: signalReportActionabilitySchema.nullable().optional(),
    already_addressed: z.boolean().nullable().optional(),
    is_suggested_reviewer: z.boolean().optional(),
    source_products: z.array(z.string()).optional(),
    implementation_pr_url: z.string().nullable().optional(),
  })
  .passthrough() satisfies z.ZodType<SignalReport>;

/**
 * Cloud `/signals/reports/` response. `results` and `count` are required at
 * the cloud serializer level but we tolerate either being missing to match
 * the prior `parseJsonResponse` behaviour (the caller fills in defaults).
 */
export const signalReportsResponseSchema = z
  .object({
    results: z.array(signalReportSchema).optional(),
    count: z.number().optional(),
  })
  .passthrough();

const signalReportArtefactContentSchema = z
  .object({
    session_id: z.string(),
    start_time: z.string(),
    end_time: z.string(),
    distinct_id: z.string(),
    content: z.string(),
    distance_to_centroid: z.number().nullable(),
  })
  .passthrough();

const priorityJudgmentContentSchema = z
  .object({
    explanation: z.string(),
    priority: signalReportPrioritySchema,
  })
  .passthrough();

const actionabilityJudgmentContentSchema = z
  .object({
    explanation: z.string(),
    actionability: signalReportActionabilitySchema,
    already_addressed: z.boolean(),
  })
  .passthrough();

const signalFindingContentSchema = z
  .object({
    signal_id: z.string(),
    relevant_code_paths: z.array(z.string()),
    relevant_commit_hashes: z.record(z.string(), z.string()),
    data_queried: z.string(),
    verified: z.boolean(),
  })
  .passthrough();

const suggestedReviewerCommitSchema = z
  .object({
    sha: z.string(),
    url: z.string(),
    reason: z.string(),
  })
  .passthrough();

const suggestedReviewerUserSchema = z
  .object({
    id: z.number(),
    uuid: z.string(),
    email: z.string(),
    first_name: z.string(),
    last_name: z.string(),
  })
  .passthrough();

const suggestedReviewerSchema = z
  .object({
    github_login: z.string(),
    github_name: z.string().nullable(),
    relevant_commits: z.array(suggestedReviewerCommitSchema),
    user: suggestedReviewerUserSchema.nullable(),
  })
  .passthrough();

const dismissalReasonValues = DISMISSAL_REASON_OPTIONS.map(
  (option) => option.value,
) as [DismissalReasonOptionValue, ...DismissalReasonOptionValue[]];

const dismissalReasonSchema = z.enum(dismissalReasonValues);

const dismissalContentSchema = z
  .object({
    reason: dismissalReasonSchema,
    note: z.string(),
    user_id: z.number().nullable(),
    user_uuid: z.string().nullable(),
  })
  .passthrough();

/**
 * Generic catch-all artefact. Used for any `type` value that doesn't have a
 * dedicated content schema (above). The shared TS `SignalReportArtefact`
 * accepts any `content` so we mirror that here.
 */
const genericArtefactSchema = z
  .object({
    id: z.string().min(1).max(128),
    type: z.string().min(1).max(64),
    content: signalReportArtefactContentSchema,
    created_at: z.string(),
  })
  .passthrough() satisfies z.ZodType<SignalReportArtefact>;

const priorityJudgmentArtefactSchema = z
  .object({
    id: z.string().min(1).max(128),
    type: z.literal("priority_judgment"),
    content: priorityJudgmentContentSchema,
    created_at: z.string(),
  })
  .passthrough() satisfies z.ZodType<PriorityJudgmentArtefact>;

const actionabilityJudgmentArtefactSchema = z
  .object({
    id: z.string().min(1).max(128),
    type: z.literal("actionability_judgment"),
    content: actionabilityJudgmentContentSchema,
    created_at: z.string(),
  })
  .passthrough() satisfies z.ZodType<ActionabilityJudgmentArtefact>;

const signalFindingArtefactSchema = z
  .object({
    id: z.string().min(1).max(128),
    type: z.literal("signal_finding"),
    content: signalFindingContentSchema,
    created_at: z.string(),
  })
  .passthrough() satisfies z.ZodType<SignalFindingArtefact>;

const suggestedReviewersArtefactSchema = z
  .object({
    id: z.string().min(1).max(128),
    type: z.literal("suggested_reviewers"),
    content: z.array(suggestedReviewerSchema),
    created_at: z.string(),
  })
  .passthrough() satisfies z.ZodType<SuggestedReviewersArtefact>;

const dismissalArtefactSchema = z
  .object({
    id: z.string().min(1).max(128),
    type: z.literal("dismissal"),
    content: dismissalContentSchema,
    created_at: z.string(),
  })
  .passthrough() satisfies z.ZodType<DismissalArtefact>;

/**
 * Result entry on `/signals/reports/{id}/artefacts/`. The cloud's `type`
 * field discriminates between several content shapes; we union the
 * recognised variants and fall back to `genericArtefactSchema` for any
 * unknown `type`. Order matters — the typed variants must come before the
 * generic fallback so they win when both could parse.
 */
const signalReportArtefactResultSchema = z.union([
  priorityJudgmentArtefactSchema,
  actionabilityJudgmentArtefactSchema,
  signalFindingArtefactSchema,
  suggestedReviewersArtefactSchema,
  dismissalArtefactSchema,
  genericArtefactSchema,
]) satisfies z.ZodType<SignalReportArtefactsResponse["results"][number]>;

const unavailableReasonSchema = z.enum([
  "forbidden",
  "not_found",
  "invalid_payload",
  "request_failed",
]);

/**
 * Cloud `/signals/reports/{id}/artefacts/` response. The error-path
 * `unavailableReason` is set by `CloudTaskClient` itself when the HTTP
 * call fails — the cloud never returns that field — but we keep it in the
 * schema for symmetry with the shared `SignalReportArtefactsResponse` type.
 */
export const signalReportArtefactsResponseSchema = z
  .object({
    results: z.array(signalReportArtefactResultSchema).optional(),
    count: z.number().optional(),
    unavailableReason: unavailableReasonSchema.optional(),
  })
  .passthrough();

/**
 * Response from a JSON-RPC `command/` POST. We only need the discriminator
 * fields here — `processed`, `result`, and `error`. Their inner shapes vary
 * with the agent runtime, so we type them as `unknown` and let
 * `extractProcessedState` parse the relevant slice with a tighter schema.
 */
export const taskRunCommandResponseSchema = z
  .object({
    jsonrpc: z.string().optional(),
    id: z.unknown().optional(),
    processed: z.unknown().optional(),
    result: z.unknown().optional(),
    error: z.unknown().optional(),
  })
  .passthrough();

const storedLogEntryNotificationSchema = z
  .object({
    id: z.number().optional(),
    method: z.string().optional(),
    params: z.unknown().optional(),
    result: z.unknown().optional(),
    error: z.unknown().optional(),
  })
  .passthrough();

const storedLogEntrySchema = z
  .object({
    type: z.string().min(1).max(128),
    timestamp: z.string().optional(),
    notification: storedLogEntryNotificationSchema.optional(),
  })
  .passthrough() satisfies z.ZodType<StoredLogEntry>;

export const sessionLogsResponseSchema = z.array(storedLogEntrySchema);

const repoEntrySchema = z.union([
  z.string().min(1).max(140),
  z
    .object({
      full_name: z.string().min(1).max(140).optional(),
      name: z.string().min(1).max(140).optional(),
    })
    .passthrough(),
]);

/**
 * The repos endpoint returns one of several shapes depending on installation
 * state and pagination wrapper. The renderer's `normalizeGithubRepositories`
 * already handles the same set; mirror its tolerance here so a wrapper change
 * doesn't silently empty the integration cache and lock the hedgehog out of
 * every repo for 5 minutes.
 */
export const integrationReposResponseSchema = z
  .object({
    repositories: z.array(repoEntrySchema).optional(),
    results: z.array(repoEntrySchema).optional(),
  })
  .passthrough();

export type IntegrationReposResponse = z.infer<
  typeof integrationReposResponseSchema
>;

export const integrationsResponseSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            installation_id: z.string().min(1).max(64),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

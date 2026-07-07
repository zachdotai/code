import { type PrMergeQueueStatus, prMergeQueueStatusSchema } from "./schemas";

/**
 * A GitHub check-run as returned by the REST `commits/{sha}/check-runs`
 * endpoint (the subset we read). Kept loose so callers can pass the raw JSON.
 */
export interface CheckRun {
  name: string;
  status: string;
  conclusion?: string | null;
  details_url?: string | null;
  html_url?: string | null;
  started_at?: string | null;
}

/**
 * A merge-queue provider that surfaces its state as a GitHub check run on the
 * PR head commit (Trunk, Mergify, bors, Aviator, Kodiak, Graphite, ...). We
 * identify the provider by the check-run name so the badge works on any repo
 * with zero configuration. GitHub's *native* merge queue posts no named check
 * run and is handled separately via the GraphQL `mergeQueueEntry` field
 * (see `mapNativeMergeQueueState`).
 *
 * Matching is best-effort by design: the check-run names below are the public,
 * observable names each provider posts today. Add or refine a `matches` entry
 * as new queues show up — nothing else in the pipeline is provider-aware.
 */
export interface CheckRunMergeQueueProvider {
  id: string;
  matches: (checkRunName: string) => boolean;
}

const startsWith = (prefix: string) => (name: string) =>
  name.toLowerCase().startsWith(prefix.toLowerCase());

const includes = (needle: string) => (name: string) =>
  name.toLowerCase().includes(needle.toLowerCase());

// Ordered by specificity; the first provider with a matching run wins. Trunk is
// first so its behavior is unchanged from the original single-provider code.
export const CHECK_RUN_MERGE_QUEUE_PROVIDERS: CheckRunMergeQueueProvider[] = [
  { id: "trunk", matches: startsWith("Trunk Merge Queue") },
  {
    id: "mergify",
    matches: (name) => startsWith("Queue:")(name) || includes("mergify")(name),
  },
  { id: "aviator", matches: includes("aviator") },
  { id: "kodiak", matches: startsWith("kodiakhq") },
  { id: "graphite", matches: includes("graphite") },
  { id: "bors", matches: startsWith("bors") },
];

function toStatus(
  run: CheckRun,
  providerName: string,
): PrMergeQueueStatus | null {
  const status = prMergeQueueStatusSchema.shape.status.safeParse(run.status);
  if (!status.success) return null;
  const conclusion = prMergeQueueStatusSchema.shape.conclusion.safeParse(
    run.conclusion,
  );
  return {
    status: status.data,
    conclusion: conclusion.success ? conclusion.data : null,
    detailsUrl: run.details_url ?? run.html_url ?? null,
    name: run.name || providerName,
  };
}

/**
 * Resolve the live merge-queue status from a PR head commit's check runs by
 * matching the first known provider. Returns null when no provider's queue
 * check is present. Pure — the service supplies the fetched check runs.
 */
export function resolveMergeQueueFromCheckRuns(
  checkRuns: CheckRun[],
): PrMergeQueueStatus | null {
  for (const provider of CHECK_RUN_MERGE_QUEUE_PROVIDERS) {
    const runs = checkRuns.filter((run) => provider.matches(run.name));
    if (runs.length === 0) continue;

    // A PR can accumulate stale runs across re-enqueues; take the most recently
    // started one as the live status.
    const latest = runs.reduce((a, b) =>
      (b.started_at ?? "") > (a.started_at ?? "") ? b : a,
    );

    const mapped = toStatus(latest, provider.id);
    if (mapped) return mapped;
  }
  return null;
}

/**
 * Map GitHub's native merge-queue `PullRequest.mergeQueueEntry.state` to the
 * shared status shape. Native queue posts no named check run, so this reads the
 * GraphQL enum instead. Null when the PR has no queue entry.
 *
 * @see https://docs.github.com/en/graphql/reference/enums#mergequeueentrystate
 */
export function mapNativeMergeQueueState(
  state: string | null | undefined,
): PrMergeQueueStatus | null {
  const base = { detailsUrl: null, name: "GitHub merge queue" } as const;
  switch (state) {
    case "QUEUED":
      return { status: "queued", conclusion: null, ...base };
    // Awaiting/locked/mergeable all mean "at the front, checks running or about
    // to merge" — surface as the testing state until the PR flips to merged.
    case "AWAITING_CHECKS":
    case "LOCKED":
    case "MERGEABLE":
      return { status: "in_progress", conclusion: null, ...base };
    case "UNMERGEABLE":
      return { status: "completed", conclusion: "failure", ...base };
    default:
      return null;
  }
}

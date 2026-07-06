import type { PrActionType } from "@posthog/shared";

export type PrVisualIcon = "merged" | "pull-request" | "queue";

export interface PrAction {
  id: PrActionType;
  label: string;
}

export interface PrVisualConfig {
  color: "gray" | "green" | "red" | "purple" | "orange";
  icon: PrVisualIcon;
  label: string;
  actions: PrAction[];
}

/**
 * The PR's live Trunk merge-queue state, derived from the `Trunk Merge Queue`
 * check-run status/conclusion. `null` means the PR is not (or no longer) in the
 * queue — a completed+success run resolves to null because the PR flips to
 * merged moments later, and a cancelled run just returns to the plain Open badge.
 */
export type MergeQueueVisualState = "queued" | "testing" | "failed" | null;

export function deriveMergeQueueState(
  status: "queued" | "in_progress" | "completed" | null | undefined,
  conclusion: string | null | undefined,
): MergeQueueVisualState {
  switch (status) {
    case "queued":
      return "queued";
    case "in_progress":
      return "testing";
    case "completed":
      return conclusion === "failure" || conclusion === "timed_out"
        ? "failed"
        : null;
    default:
      return null;
  }
}

export function getPrVisualConfig(
  state: string,
  merged: boolean,
  draft: boolean,
  mergeQueue: MergeQueueVisualState = null,
): PrVisualConfig {
  if (merged) {
    return {
      color: "purple",
      icon: "merged",
      label: "Merged",
      actions: [],
    };
  }
  if (state === "closed") {
    return {
      color: "red",
      icon: "pull-request",
      label: "Closed",
      actions: [{ id: "reopen", label: "Reopen PR" }],
    };
  }
  if (draft) {
    return {
      color: "gray",
      icon: "pull-request",
      label: "Draft",
      actions: [
        { id: "ready", label: "Ready for review" },
        { id: "close", label: "Close PR" },
      ],
    };
  }
  if (mergeQueue === "queued" || mergeQueue === "testing") {
    return {
      color: "orange",
      icon: "queue",
      label: mergeQueue === "queued" ? "Queued" : "Testing",
      actions: [{ id: "merge-queue-cancel", label: "Cancel queue run" }],
    };
  }
  if (mergeQueue === "failed") {
    return {
      color: "red",
      icon: "pull-request",
      label: "Queue failed",
      actions: [
        { id: "merge-queue", label: "Retry merge via queue" },
        { id: "close", label: "Close PR" },
      ],
    };
  }
  return {
    color: "green",
    icon: "pull-request",
    label: "Open",
    actions: [
      { id: "merge-queue", label: "Merge via queue" },
      { id: "draft", label: "Convert to draft" },
      { id: "close", label: "Close PR" },
    ],
  };
}

export function getOptimisticPrState(action: PrActionType) {
  switch (action) {
    case "close":
      return { state: "closed", merged: false, draft: false };
    case "reopen":
      return { state: "open", merged: false, draft: false };
    case "ready":
      return { state: "open", merged: false, draft: false };
    case "draft":
      return { state: "open", merged: false, draft: true };
    // Merge-queue actions don't change the PR's own lifecycle state — the queue
    // status is patched on a separate cache. The PR stays open until Trunk merges it.
    case "merge-queue":
    case "merge-queue-cancel":
      return { state: "open", merged: false, draft: false };
  }
}

export const PR_ACTION_LABELS: Record<PrActionType, string> = {
  close: "PR closed",
  reopen: "PR reopened",
  ready: "PR marked as ready for review",
  draft: "PR converted to draft",
  "merge-queue": "PR submitted to merge queue",
  "merge-queue-cancel": "Merge queue run cancelled",
};

export function parsePrNumber(prUrl: string): string | undefined {
  return prUrl.match(/\/pull\/(\d+)/)?.[1];
}

import {
  ANALYTICS_EVENTS,
  type BranchMismatchActionProperties,
  type BranchMismatchWarningShownProperties,
} from "@posthog/shared";

export type BranchMismatchBannerAction =
  | "switch"
  | "relink"
  | "dismiss"
  | "shown";

export interface BranchMismatchContext {
  taskId: string;
  linkedBranch: string | null;
  currentBranch: string | null;
  hasUncommittedChanges: boolean;
}

export interface CheckoutBranchRequest {
  directoryPath: string;
  branchName: string;
}

export interface LinkBranchRequest {
  taskId: string;
  branchName: string;
}

export type BranchMismatchAnalyticsEvent =
  | {
      event: typeof ANALYTICS_EVENTS.BRANCH_MISMATCH_WARNING_SHOWN;
      properties: BranchMismatchWarningShownProperties;
    }
  | {
      event: typeof ANALYTICS_EVENTS.BRANCH_MISMATCH_ACTION;
      properties: BranchMismatchActionProperties;
    };

export function buildBranchMismatchAnalyticsEvent(
  action: BranchMismatchBannerAction,
  context: BranchMismatchContext,
): BranchMismatchAnalyticsEvent | null {
  const { taskId, linkedBranch, currentBranch, hasUncommittedChanges } =
    context;
  if (!linkedBranch || !currentBranch) {
    return null;
  }

  if (action === "shown") {
    return {
      event: ANALYTICS_EVENTS.BRANCH_MISMATCH_WARNING_SHOWN,
      properties: {
        task_id: taskId,
        linked_branch: linkedBranch,
        current_branch: currentBranch,
        has_uncommitted_changes: hasUncommittedChanges,
      },
    };
  }

  return {
    event: ANALYTICS_EVENTS.BRANCH_MISMATCH_ACTION,
    properties: {
      task_id: taskId,
      action,
      linked_branch: linkedBranch,
      current_branch: currentBranch,
    },
  };
}

export function buildCheckoutBranchRequest(
  repoPath: string | null,
  linkedBranch: string | null,
): CheckoutBranchRequest | null {
  if (!repoPath || !linkedBranch) {
    return null;
  }
  return { directoryPath: repoPath, branchName: linkedBranch };
}

export function buildLinkBranchRequest(
  taskId: string,
  currentBranch: string | null,
): LinkBranchRequest | null {
  if (!currentBranch) {
    return null;
  }
  return { taskId, branchName: currentBranch };
}

export function resolveBranchMismatchError(
  error: unknown,
  fallback: string,
): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

import {
  type BranchMismatchBannerAction,
  buildBranchMismatchAnalyticsEvent,
  buildCheckoutBranchRequest,
  buildLinkBranchRequest,
  resolveBranchMismatchError,
} from "@posthog/core/workspace/branchMismatchBanner";
import { useHostTRPC } from "@posthog/host-router/react";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { track } from "../../shell/analytics";
import { logger } from "../../shell/logger";
import { invalidateGitBranchQueries } from "../git-interaction/gitCacheKeys";
import { useGitQueries } from "../git-interaction/useGitQueries";
import { useBranchMismatchGuard } from "./useBranchMismatch";

const log = logger.scope("branch-mismatch");

export interface BranchMismatchBannerState {
  linkedBranch: string;
  currentBranch: string;
  actionError: string | null;
  isSwitching: boolean;
  isRelinking: boolean;
  onSwitch: () => void;
  onUseCurrentBranch: () => void;
  onDismiss: () => void;
}

interface UseBranchMismatchBannerOptions {
  taskId: string;
  repoPath: string | null;
}

/**
 * Ambient (non-blocking) surface for a task whose working tree is on a
 * different branch than the one linked to the task. Unlike the old dialog it
 * never intercepts sending: the user can switch to the linked branch, re-link
 * the task to the current branch (a durable choice), or dismiss for the
 * session.
 */
export function useBranchMismatchBanner({
  taskId,
  repoPath,
}: UseBranchMismatchBannerOptions): BranchMismatchBannerState | null {
  const { shouldWarn, linkedBranch, currentBranch, dismissWarning } =
    useBranchMismatchGuard(taskId);
  const { hasChanges: hasUncommittedChanges } = useGitQueries(
    repoPath ?? undefined,
  );
  const [actionError, setActionError] = useState<string | null>(null);

  const emitAction = useCallback(
    (action: BranchMismatchBannerAction) => {
      const analytics = buildBranchMismatchAnalyticsEvent(action, {
        taskId,
        linkedBranch,
        currentBranch,
        hasUncommittedChanges,
      });
      if (analytics) track(analytics.event, analytics.properties);
    },
    [taskId, linkedBranch, currentBranch, hasUncommittedChanges],
  );

  // One "shown" per appearance, re-armed when the banner hides.
  const shownRef = useRef(false);
  useEffect(() => {
    if (shouldWarn && !shownRef.current) {
      shownRef.current = true;
      emitAction("shown");
    } else if (!shouldWarn) {
      shownRef.current = false;
      setActionError(null);
    }
  }, [shouldWarn, emitAction]);

  const trpc = useHostTRPC();
  const { mutate: checkoutBranch, isPending: isSwitching } = useMutation(
    trpc.git.checkoutBranch.mutationOptions({
      onSuccess: () => {
        if (repoPath) invalidateGitBranchQueries(repoPath);
        // The mismatch clears on its own once the branch queries refetch;
        // dismissing hides the banner immediately instead of a beat later.
        dismissWarning();
        setActionError(null);
      },
      onError: (error) => {
        log.error("Failed to switch branch", error);
        setActionError(
          resolveBranchMismatchError(error, "Failed to switch branch"),
        );
      },
    }),
  );

  const { mutate: linkBranch, isPending: isRelinking } = useMutation(
    trpc.workspace.linkBranch.mutationOptions({
      // The LinkedBranchChanged event invalidates the workspace query, which
      // clears the mismatch and hides the banner.
      onSuccess: () => setActionError(null),
      onError: (error) => {
        log.error("Failed to re-link branch", error);
        setActionError(
          resolveBranchMismatchError(error, "Failed to update the task branch"),
        );
      },
    }),
  );

  const handleSwitch = useCallback(() => {
    const request = buildCheckoutBranchRequest(repoPath, linkedBranch);
    if (!request) return;
    setActionError(null);
    emitAction("switch");
    checkoutBranch(request);
  }, [repoPath, linkedBranch, emitAction, checkoutBranch]);

  const handleUseCurrentBranch = useCallback(() => {
    const request = buildLinkBranchRequest(taskId, currentBranch);
    if (!request) return;
    setActionError(null);
    emitAction("relink");
    linkBranch(request);
  }, [taskId, currentBranch, emitAction, linkBranch]);

  const handleDismiss = useCallback(() => {
    emitAction("dismiss");
    setActionError(null);
    dismissWarning();
  }, [emitAction, dismissWarning]);

  if (!shouldWarn || !linkedBranch || !currentBranch) return null;

  return {
    linkedBranch,
    currentBranch,
    actionError,
    isSwitching,
    isRelinking,
    onSwitch: handleSwitch,
    onUseCurrentBranch: handleUseCurrentBranch,
    onDismiss: handleDismiss,
  };
}

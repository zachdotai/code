import { deriveMergeQueueState } from "@posthog/core/git-interaction/prStatus";
import { useHostTRPC } from "@posthog/host-router/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

interface UseMergeQueueStatusOptions {
  /** Only poll when the PR could be in the queue (open and not yet merged). */
  enabled: boolean;
}

/**
 * Reads the PR's merge-queue status (whichever queue the repo uses — resolved
 * provider-agnostically server-side) and polls every 30s while it is actively
 * queued/testing. When the run settles (completes), it invalidates the
 * PR-details and task-PR-status caches so the badge flips to Merged and the
 * server re-emits `taskPrInfoChanged` (which the workspace-events contribution
 * turns into the "PR merged" notification).
 */
export function useMergeQueueStatus(
  prUrl: string | null,
  { enabled }: UseMergeQueueStatusOptions,
) {
  const trpc = useHostTRPC();
  const queryClient = useQueryClient();

  const query = useQuery({
    ...trpc.git.getPrMergeQueueStatus.queryOptions({ prUrl: prUrl as string }),
    enabled: !!prUrl && enabled,
    staleTime: 25_000,
    retry: 1,
    refetchInterval: (q) => {
      const s = deriveMergeQueueState(
        q.state.data?.status,
        q.state.data?.conclusion,
      );
      return s === "queued" || s === "testing" ? 30_000 : false;
    },
  });

  const mergeQueueState = deriveMergeQueueState(
    query.data?.status,
    query.data?.conclusion,
  );

  // When the run leaves an active state (queued/testing -> settled), the PR is
  // about to merge or has dropped out. Refresh the PR lifecycle + task PR status
  // so the merged badge and merge notification land promptly.
  const wasActive = useRef(false);
  useEffect(() => {
    const active =
      mergeQueueState === "queued" || mergeQueueState === "testing";
    if (wasActive.current && !active) {
      void queryClient.invalidateQueries(
        trpc.git.getPrDetailsByUrl.pathFilter(),
      );
      void queryClient.invalidateQueries(
        trpc.workspace.getTaskPrStatus.pathFilter(),
      );
    }
    wasActive.current = active;
  }, [mergeQueueState, queryClient, trpc]);

  return {
    mergeQueueState,
    detailsUrl: query.data?.detailsUrl ?? null,
  };
}

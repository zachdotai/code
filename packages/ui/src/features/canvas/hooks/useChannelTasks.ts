import type { ChannelTaskRecord } from "@posthog/core/canvas/channelTaskSchemas";
import { useHostTRPC } from "@posthog/host-router/react";
import { AUTH_SCOPED_QUERY_META } from "@posthog/ui/features/auth/authQueries";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

/**
 * Tasks filed to a channel — backed by desktop_file_system rows. Pass the
 * channel's known `channelPath` (from useChannels) so the service can skip the
 * getEntry round-trip that resolves the path from the id.
 */
export function useChannelTasks(
  channelId: string | undefined,
  channelPath?: string,
): {
  tasks: ChannelTaskRecord[];
  isLoading: boolean;
} {
  const trpc = useHostTRPC();
  const { data, isLoading } = useQuery(
    trpc.channelTasks.list.queryOptions(
      { channelId: channelId ?? "", channelPath },
      { enabled: !!channelId, staleTime: 5_000, meta: AUTH_SCOPED_QUERY_META },
    ),
  );
  return { tasks: data ?? [], isLoading };
}

/**
 * Warm the filed-tasks cache for a channel ahead of opening it (e.g. on hover),
 * so expanding the channel doesn't cold-fetch its tasks. Respects the same
 * staleTime, so it no-ops when the data is already fresh.
 */
export function usePrefetchChannelTasks(): (
  channelId: string,
  channelPath?: string,
) => void {
  const trpc = useHostTRPC();
  const queryClient = useQueryClient();
  return useCallback(
    (channelId: string, channelPath?: string) => {
      void queryClient.prefetchQuery(
        trpc.channelTasks.list.queryOptions(
          { channelId, channelPath },
          { staleTime: 5_000, meta: AUTH_SCOPED_QUERY_META },
        ),
      );
    },
    [trpc, queryClient],
  );
}

export function useChannelTaskMutations() {
  const trpc = useHostTRPC();
  const queryClient = useQueryClient();

  const invalidate = () => {
    void queryClient.invalidateQueries(trpc.channelTasks.list.pathFilter());
  };

  const file = useMutation(
    trpc.channelTasks.file.mutationOptions({ onSuccess: invalidate }),
  );
  const unfile = useMutation(
    trpc.channelTasks.unfile.mutationOptions({ onSuccess: invalidate }),
  );

  return {
    fileTask: (channelId: string, taskId: string, taskTitle: string) =>
      file.mutateAsync({ channelId, taskId, taskTitle }),
    unfileTask: (id: string) => unfile.mutateAsync({ id }),
    isFiling: file.isPending,
    isUnfiling: unfile.isPending,
  };
}

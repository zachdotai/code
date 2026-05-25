import { useTRPC } from "@renderer/trpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useCallback } from "react";

/**
 * Subscribe to usage snapshots pushed by the main-process `UsageMonitorService`.
 * Avoids the renderer doing its own gateway polling — the service is the single
 * source of truth and we just consume what it broadcasts every ~30s.
 */
export function useUsage({ enabled = true }: { enabled?: boolean } = {}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const query = useQuery({
    ...trpc.usageMonitor.getLatest.queryOptions(),
    enabled,
  });
  const refreshMutation = useMutation(
    trpc.usageMonitor.refresh.mutationOptions(),
  );

  useSubscription(
    trpc.usageMonitor.onUsageUpdated.subscriptionOptions(undefined, {
      enabled,
      onData: (data) => {
        queryClient.setQueryData(trpc.usageMonitor.getLatest.queryKey(), data);
      },
    }),
  );

  const refetch = useCallback(async () => {
    const fresh = await refreshMutation.mutateAsync();
    if (fresh) {
      queryClient.setQueryData(trpc.usageMonitor.getLatest.queryKey(), fresh);
    }
    return fresh;
  }, [refreshMutation, queryClient, trpc.usageMonitor.getLatest]);

  return {
    usage: query.data ?? null,
    isLoading: query.isLoading,
    refetch,
  };
}

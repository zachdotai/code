import { useTRPC } from "@renderer/trpc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";

/**
 * Subscribed view of the archived project list. Mirrors `useWorkProjects` but
 * hits `workProjects.listArchived`. Re-fetches when any project changes so
 * archive / unarchive optimistic updates are reconciled against the server.
 */
export function useArchivedProjects() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const query = useQuery(trpc.workProjects.listArchived.queryOptions());

  useSubscription(
    trpc.workProjects.onProjectsChanged.subscriptionOptions(undefined, {
      onData: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.workProjects.listArchived.queryKey(),
        });
      },
    }),
  );

  return query;
}

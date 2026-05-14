import { trpcClient, useTRPC } from "@renderer/trpc";
import { toast } from "@renderer/utils/toast";
import type { WorkProject } from "@shared/types/work-projects";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

/**
 * Pin / unpin a project with optimistic cache updates.
 *
 * Pinned projects appear in the sidebar's pinned subtree, on the home
 * "Pinned" rail, and at the top of the project switcher.
 */
export function usePinProject() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useCallback(
    async (projectId: string, pinned: boolean): Promise<void> => {
      const listKey = trpc.workProjects.list.queryKey();
      const detailKey = trpc.workProjects.get.queryKey({ projectId });

      const prevList = queryClient.getQueryData<WorkProject[]>(listKey);
      const prevDetail = queryClient.getQueryData<WorkProject>(detailKey);

      const stamp = pinned ? new Date().toISOString() : undefined;
      const patch = (p: WorkProject): WorkProject => {
        if (p.id !== projectId) return p;
        if (stamp) return { ...p, pinnedAt: stamp };
        const { pinnedAt: _drop, ...rest } = p;
        return rest as WorkProject;
      };

      if (prevList) {
        queryClient.setQueryData<WorkProject[]>(listKey, prevList.map(patch));
      }
      if (prevDetail) {
        queryClient.setQueryData<WorkProject>(detailKey, patch(prevDetail));
      }

      try {
        if (pinned) {
          await trpcClient.workProjects.pin.mutate({ projectId });
        } else {
          await trpcClient.workProjects.unpin.mutate({ projectId });
        }
      } catch (err) {
        if (prevList) queryClient.setQueryData(listKey, prevList);
        if (prevDetail) queryClient.setQueryData(detailKey, prevDetail);
        toast.error(
          pinned ? "Couldn't pin project" : "Couldn't unpin project",
          {
            description:
              err instanceof Error ? err.message : "Please try again.",
          },
        );
      }
    },
    [trpc, queryClient],
  );
}

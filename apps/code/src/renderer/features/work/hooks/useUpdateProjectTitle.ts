import { trpcClient, useTRPC } from "@renderer/trpc";
import { toast } from "@renderer/utils/toast";
import type { ProjectIconId, WorkProject } from "@shared/types/work-projects";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

interface UpdateProjectTitlePatch {
  name?: string;
  tagline?: string;
  iconId?: ProjectIconId;
}

/**
 * Update a project's name, tagline, and/or icon with optimistic cache updates.
 * Mirrors the canvas hook's `updateTitleTile` but works from outside the
 * detail view (e.g. the projects list card).
 */
export function useUpdateProjectTitle() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useCallback(
    async (
      projectId: string,
      patch: UpdateProjectTitlePatch,
    ): Promise<void> => {
      const listKey = trpc.workProjects.list.queryKey();
      const detailKey = trpc.workProjects.get.queryKey({ projectId });

      const prevList = queryClient.getQueryData<WorkProject[]>(listKey);
      const prevDetail = queryClient.getQueryData<WorkProject>(detailKey);

      const apply = (p: WorkProject): WorkProject => {
        if (p.id !== projectId) return p;
        const tiles = p.tiles.map((t) => {
          if (t.type !== "title") return t;
          return {
            ...t,
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.tagline !== undefined ? { tagline: patch.tagline } : {}),
            ...(patch.iconId !== undefined ? { iconId: patch.iconId } : {}),
          };
        });
        return {
          ...p,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.tagline !== undefined ? { tagline: patch.tagline } : {}),
          ...(patch.iconId !== undefined ? { iconId: patch.iconId } : {}),
          tiles,
        };
      };

      if (prevList) {
        queryClient.setQueryData<WorkProject[]>(listKey, prevList.map(apply));
      }
      if (prevDetail) {
        queryClient.setQueryData<WorkProject>(detailKey, apply(prevDetail));
      }

      try {
        await trpcClient.workProjects.updateTitleTile.mutate({
          projectId,
          ...patch,
        });
      } catch (err) {
        if (prevList) queryClient.setQueryData(listKey, prevList);
        if (prevDetail) queryClient.setQueryData(detailKey, prevDetail);
        toast.error("Couldn't update project", {
          description: err instanceof Error ? err.message : "Please try again.",
        });
      }
    },
    [trpc, queryClient],
  );
}

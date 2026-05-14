import { trpcClient, useTRPC } from "@renderer/trpc";
import { toast } from "@renderer/utils/toast";
import type { WorkProject } from "@shared/types/work-projects";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

/**
 * Archive / unarchive a project with optimistic cache updates.
 *
 * Archived projects are hidden from the main `list()` and surfaced in
 * `listArchived()`. Restore strips `archivedAt`.
 */
export function useArchiveProject() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const archive = useCallback(
    async (project: WorkProject): Promise<void> => {
      const projectId = project.id;
      const listKey = trpc.workProjects.list.queryKey();
      const archivedKey = trpc.workProjects.listArchived.queryKey();
      const detailKey = trpc.workProjects.get.queryKey({ projectId });

      const prevList = queryClient.getQueryData<WorkProject[]>(listKey);
      const prevArchived = queryClient.getQueryData<WorkProject[]>(archivedKey);
      const prevDetail = queryClient.getQueryData<WorkProject>(detailKey);

      const stamped: WorkProject = {
        ...project,
        archivedAt: new Date().toISOString(),
      };

      if (prevList) {
        queryClient.setQueryData<WorkProject[]>(
          listKey,
          prevList.filter((p) => p.id !== projectId),
        );
      }
      queryClient.setQueryData<WorkProject[]>(archivedKey, [
        stamped,
        ...(prevArchived ?? []).filter((p) => p.id !== projectId),
      ]);
      if (prevDetail) {
        queryClient.setQueryData<WorkProject>(detailKey, stamped);
      }

      try {
        await trpcClient.workProjects.archive.mutate({ projectId });
        toast.success(`Archived "${project.name}"`);
      } catch (err) {
        if (prevList) queryClient.setQueryData(listKey, prevList);
        if (prevArchived !== undefined)
          queryClient.setQueryData(archivedKey, prevArchived);
        if (prevDetail) queryClient.setQueryData(detailKey, prevDetail);
        toast.error("Couldn't archive project", {
          description: err instanceof Error ? err.message : "Please try again.",
        });
      }
    },
    [trpc, queryClient],
  );

  const unarchive = useCallback(
    async (project: WorkProject): Promise<void> => {
      const projectId = project.id;
      const listKey = trpc.workProjects.list.queryKey();
      const archivedKey = trpc.workProjects.listArchived.queryKey();
      const detailKey = trpc.workProjects.get.queryKey({ projectId });

      const prevList = queryClient.getQueryData<WorkProject[]>(listKey);
      const prevArchived = queryClient.getQueryData<WorkProject[]>(archivedKey);
      const prevDetail = queryClient.getQueryData<WorkProject>(detailKey);

      const { archivedAt: _drop, ...rest } = project;
      const restored = rest as WorkProject;

      queryClient.setQueryData<WorkProject[]>(archivedKey, [
        ...(prevArchived ?? []).filter((p) => p.id !== projectId),
      ]);
      queryClient.setQueryData<WorkProject[]>(listKey, [
        restored,
        ...(prevList ?? []).filter((p) => p.id !== projectId),
      ]);
      if (prevDetail) {
        queryClient.setQueryData<WorkProject>(detailKey, restored);
      }

      try {
        await trpcClient.workProjects.unarchive.mutate({ projectId });
        toast.success(`Restored "${project.name}"`);
      } catch (err) {
        if (prevList !== undefined) queryClient.setQueryData(listKey, prevList);
        if (prevArchived !== undefined)
          queryClient.setQueryData(archivedKey, prevArchived);
        if (prevDetail) queryClient.setQueryData(detailKey, prevDetail);
        toast.error("Couldn't restore project", {
          description: err instanceof Error ? err.message : "Please try again.",
        });
      }
    },
    [trpc, queryClient],
  );

  return { archive, unarchive };
}

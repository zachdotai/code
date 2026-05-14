import { archiveTaskImperative } from "@features/tasks/hooks/useArchiveTask";
import { useProjectChatsStore } from "@renderer/stores/projectChatsStore";
import { trpcClient, useTRPC } from "@renderer/trpc";
import { toast } from "@renderer/utils/toast";
import type { WorkProject } from "@shared/types/work-projects";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

const UNDO_WINDOW_MS = 5000;

/**
 * Delete a project with a 5-second undo grace window.
 *
 * 1. Soft-delete server-side (sets `pendingDeletionAt`). The project drops
 *    out of `list()` and `get()`.
 * 2. Caches are optimistically updated so the UI reflects the deletion.
 * 3. A success toast with an Undo action appears for 5s.
 * 4. On Undo: `undoDelete` restores the project + cache.
 * 5. On 5s expiry (no undo): `commitDelete` permanently removes the project,
 *    clears the chat-id mapping, and archives the underlying chat task.
 *
 * If the app closes within the 5s window, the service's
 * `recoverStaleDeletions` (30s grace) commits the deletion on next boot.
 */
export function useDeleteProjectWithUndo(options?: {
  onCommitted?: (projectId: string) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const clearChatId = useProjectChatsStore((s) => s.clearChatId);
  const getChatId = useProjectChatsStore((s) => s.getChatId);

  return useCallback(
    async (project: WorkProject) => {
      const projectId = project.id;
      const listKey = trpc.workProjects.list.queryKey();
      const detailKey = trpc.workProjects.get.queryKey({ projectId });

      const prevList = queryClient.getQueryData<WorkProject[]>(listKey);
      const prevDetail = queryClient.getQueryData<WorkProject>(detailKey);

      // Optimistically remove from caches so the UI reacts instantly.
      if (prevList) {
        queryClient.setQueryData<WorkProject[]>(
          listKey,
          prevList.filter((p) => p.id !== projectId),
        );
      }
      queryClient.setQueryData<WorkProject>(detailKey, undefined as never);

      try {
        await trpcClient.workProjects.softDelete.mutate({ projectId });
      } catch (err) {
        if (prevList) queryClient.setQueryData(listKey, prevList);
        if (prevDetail) queryClient.setQueryData(detailKey, prevDetail);
        toast.error("Couldn't delete project", {
          description: err instanceof Error ? err.message : "Please try again.",
        });
        return;
      }

      let settled = false;

      const commit = async () => {
        if (settled) return;
        settled = true;
        try {
          const chatId = getChatId(projectId);
          if (chatId) {
            clearChatId(projectId);
            await archiveTaskImperative(chatId, queryClient, {
              skipNavigate: true,
            }).catch(() => undefined);
          }
          await trpcClient.workProjects.commitDelete.mutate({ projectId });
          options?.onCommitted?.(projectId);
        } catch (err) {
          toast.error("Couldn't finish deleting project", {
            description:
              err instanceof Error ? err.message : "Please try again.",
          });
        }
      };

      const undo = async () => {
        if (settled) return;
        settled = true;
        try {
          const restored = await trpcClient.workProjects.undoDelete.mutate({
            projectId,
          });
          if (restored) {
            queryClient.setQueryData<WorkProject>(detailKey, restored);
            const currentList =
              queryClient.getQueryData<WorkProject[]>(listKey) ?? [];
            if (!currentList.some((p) => p.id === projectId)) {
              queryClient.setQueryData<WorkProject[]>(listKey, [
                restored,
                ...currentList,
              ]);
            }
          }
          toast.success(`Restored "${project.name}"`);
        } catch (err) {
          toast.error("Couldn't restore project", {
            description:
              err instanceof Error ? err.message : "Please try again.",
          });
        }
      };

      // Schedule the commit; the Undo action races against this timer.
      const timer = setTimeout(() => {
        void commit();
      }, UNDO_WINDOW_MS);

      toast.success(`Deleted "${project.name}"`, {
        action: {
          label: "Undo",
          onClick: () => {
            clearTimeout(timer);
            void undo();
          },
        },
      });
    },
    [trpc, queryClient, clearChatId, getChatId, options],
  );
}

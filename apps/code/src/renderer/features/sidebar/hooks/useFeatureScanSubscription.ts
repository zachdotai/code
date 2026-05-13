import { useOptionalAuthenticatedClient } from "@features/auth/hooks/authClient";
import { useFeatureScanStore } from "@features/sidebar/stores/featureScanStore";
import { trpcClient, useTRPC } from "@renderer/trpc/client";
import { useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { logger } from "@utils/logger";
import { toast } from "@utils/toast";

const log = logger.scope("feature-scan-subscription");

export function useFeatureScanSubscription(): void {
  const trpcReact = useTRPC();
  const queryClient = useQueryClient();
  const client = useOptionalAuthenticatedClient();
  const setState = useFeatureScanStore((s) => s.setState);

  useSubscription(
    trpcReact.folders.onNewRepository.subscriptionOptions(undefined, {
      onData: async ({ id, path }) => {
        if (!client) {
          log.warn("New repository event received before authentication", {
            id,
          });
          return;
        }

        setState(id, "scanning");
        try {
          const { folders } = await trpcClient.featureScan.scanRepo.mutate({
            repoPath: path,
          });

          for (const folder of folders) {
            try {
              await client.createFileSystem({
                path: folder.name,
                type: "folder",
              });
            } catch (err) {
              log.error("Failed to create file_system folder", {
                folder: folder.name,
                err,
              });
            }
          }

          await queryClient.invalidateQueries({
            queryKey: ["file-system"],
          });
          setState(id, "done");
        } catch (err) {
          log.error("Feature scan failed", { id, err });
          setState(id, "failed");
          toast.error("Could not scan repository for feature areas", {
            description: err instanceof Error ? err.message : String(err),
          });
        }
      },
      onError: (err) => {
        log.error("onNewRepository subscription error", err);
      },
    }),
  );
}

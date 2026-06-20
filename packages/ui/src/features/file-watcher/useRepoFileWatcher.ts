import { useService } from "@posthog/di/react";
import { toRelativePath } from "@posthog/shared";
import type { FileWatcherEvent } from "@posthog/workspace-client/types";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { logger } from "../../shell/logger";
import {
  invalidateGitBranchQueries,
  invalidateGitWorkingTreeQueries,
} from "../git-interaction/gitCacheKeys";
import {
  GIT_CACHE_KEY_PROVIDER,
  type GitCacheKeyProvider,
} from "../git-interaction/gitCacheProvider";
import { usePanelLayoutStore } from "../panels/panelLayoutStore";
import { createFileWatcherCoalescer } from "./fileWatcherCoalescer";
import { FILE_WATCHER_CLIENT, type FileWatcherClient } from "./identifiers";
import { useFileWatcher } from "./useFileWatcher";

const log = logger.scope("file-watcher");

/**
 * Drives the host file watcher for a repo: starts/stops the main-side watcher
 * and reacts to its events (invalidate fs reads + git caches, close tabs for
 * deleted files). Was the renderer-only `@hooks/useFileWatcher`; now host
 * access flows through FILE_WATCHER_CLIENT + the fs/git cache-key providers.
 */
export function useRepoFileWatcher(repoPath: string | null, taskId?: string) {
  const control = useService<FileWatcherClient>(FILE_WATCHER_CLIENT);
  const cacheKeys = useService<GitCacheKeyProvider>(GIT_CACHE_KEY_PROVIDER);
  const queryClient = useQueryClient();
  const closeTabsForFile = usePanelLayoutStore((s) => s.closeTabsForFile);

  useEffect(() => {
    if (!repoPath) return;
    control.start(repoPath).catch((error) => {
      log.error("Failed to start main-side file watcher:", error);
    });
    return () => {
      void control.stop(repoPath);
    };
  }, [repoPath, control]);

  const coalescer = useMemo(
    () =>
      createFileWatcherCoalescer({
        invalidateFile(relativePath) {
          queryClient.invalidateQueries({
            queryKey: cacheKeys.fsQueryKey("readRepoFile", {
              repoPath: repoPath ?? "",
              filePath: relativePath,
            }),
          });
          queryClient.invalidateQueries({
            queryKey: cacheKeys.fsQueryKey("readRepoFileBounded", {
              repoPath: repoPath ?? "",
              filePath: relativePath,
            }),
          });
        },
        closeTabsForFile(relativePath) {
          if (taskId) closeTabsForFile(taskId, relativePath);
        },
        invalidateGitBranch() {
          if (repoPath) invalidateGitBranchQueries(repoPath);
        },
        invalidateGitWorkingTree() {
          if (repoPath) invalidateGitWorkingTreeQueries(repoPath);
        },
      }),
    [repoPath, taskId, queryClient, closeTabsForFile, cacheKeys],
  );

  useEffect(() => () => coalescer.dispose(), [coalescer]);

  const onEvent = useCallback(
    (event: FileWatcherEvent) => {
      if (!repoPath) return;
      switch (event.kind) {
        case "file-changed":
          coalescer.fileChanged(toRelativePath(event.filePath, repoPath));
          return;
        case "file-deleted":
          if (!taskId) return;
          coalescer.fileDeleted(toRelativePath(event.filePath, repoPath));
          return;
        case "git-state-changed":
          coalescer.gitStateChanged();
          return;
        case "working-tree-changed":
          coalescer.workingTreeChanged();
          return;
      }
    },
    [repoPath, taskId, coalescer],
  );

  useFileWatcher(repoPath, onEvent);
}

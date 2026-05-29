import { invalidateGitBranchQueries } from "@features/git-interaction/utils/gitCacheKeys";
import {
  type EnableFocusParams,
  FocusController,
  type FocusSagaResult,
} from "@posthog/core/focus/service";
import type { SagaLogger } from "@posthog/shared";
import type {
  FocusResult,
  FocusSession,
} from "@posthog/workspace-client/types";
import { trpcClient } from "@renderer/trpc";
import { logger } from "@utils/logger";
import { create } from "zustand";

const log = logger.scope("focus-store");

const sagaLogger: SagaLogger = {
  info: (message, data) => log.info(message, data),
  debug: (message, data) => log.debug(message, data),
  error: (message, data) => log.error(message, data),
  warn: (message, data) => log.warn(message, data),
};

const focusController = new FocusController(
  {
    cancelSessionPrompt: async (sessionId, reason) => {
      await trpcClient.agent.cancelPrompt.mutate({ sessionId, reason });
    },
    checkout: (repoPath, branch) =>
      trpcClient.focus.checkout.mutate({ repoPath, branch }),
    cleanWorkingTree: (repoPath) =>
      trpcClient.focus.cleanWorkingTree.mutate({ repoPath }),
    deleteSession: (mainRepoPath) =>
      trpcClient.focus.deleteSession.mutate({ mainRepoPath }),
    detachWorktree: (worktreePath) =>
      trpcClient.focus.detachWorktree.mutate({ worktreePath }),
    getCommitSha: (repoPath) =>
      trpcClient.focus.getCommitSha.query({ repoPath }),
    getCurrentBranch: async (mainRepoPath) =>
      await trpcClient.git.getCurrentBranch.query({
        directoryPath: mainRepoPath,
      }),
    getSession: (mainRepoPath) =>
      trpcClient.focus.getSession.query({ mainRepoPath }),
    isDirty: (repoPath) => trpcClient.focus.isDirty.query({ repoPath }),
    listLocalTaskIds: async (mainRepoPath) =>
      (
        await trpcClient.workspace.getLocalTasks.query({
          mainRepoPath,
        })
      ).map(({ taskId }) => taskId),
    listSessionIds: async (taskId) =>
      (
        await trpcClient.agent.listSessions.query({
          taskId,
        })
      ).map(({ taskRunId }) => taskRunId),
    listWorktreeTaskIds: async (worktreePath) =>
      (
        await trpcClient.workspace.getWorktreeTasks.query({
          worktreePath,
        })
      ).map(({ taskId }) => taskId),
    notifySessionContext: (sessionId, context) =>
      trpcClient.agent.notifySessionContext.mutate({ sessionId, context }),
    reattachWorktree: (worktreePath, branch) =>
      trpcClient.focus.reattachWorktree.mutate({ worktreePath, branch }),
    saveSession: (session) => trpcClient.focus.saveSession.mutate(session),
    stash: (repoPath, message) =>
      trpcClient.focus.stash.mutate({ repoPath, message }),
    stashApply: (repoPath, stashRef) =>
      trpcClient.focus.stashApply.mutate({ repoPath, stashRef }),
    startSync: (mainRepoPath, worktreePath) =>
      trpcClient.focus.startSync.mutate({ mainRepoPath, worktreePath }),
    startWatchingMainRepo: (mainRepoPath) =>
      trpcClient.focus.startWatchingMainRepo.mutate({ mainRepoPath }),
    stopSync: () => trpcClient.focus.stopSync.mutate(),
    stopWatchingMainRepo: () => trpcClient.focus.stopWatchingMainRepo.mutate(),
    toRelativeWorktreePath: (absolutePath, mainRepoPath) =>
      trpcClient.focus.toRelativeWorktreePath.query({
        absolutePath,
        mainRepoPath,
      }),
    worktreeExistsAtPath: (relativePath) =>
      trpcClient.focus.worktreeExistsAtPath.query({ relativePath }),
  },
  sagaLogger,
);

export type { FocusSagaResult };

interface FocusState {
  session: FocusSession | null;
  isLoading: boolean;
  enableFocus: (params: EnableFocusParams) => Promise<FocusSagaResult>;
  disableFocus: () => Promise<FocusResult>;
  restore: (mainRepoPath: string) => Promise<void>;
  updateSessionBranch: (worktreePath: string, newBranch: string) => void;
}

export const useFocusStore = create<FocusState>()((set, get) => ({
  session: null,
  isLoading: false,

  enableFocus: async (params) => {
    set({ isLoading: true });
    const result = await focusController.enableFocus(params, get().session);
    set({
      isLoading: false,
      session: result.success ? result.session : get().session,
    });
    if (result.success) invalidateGitBranchQueries(params.mainRepoPath);
    return result;
  },

  disableFocus: async () => {
    const { session } = get();
    if (!session) return { success: false, error: "No active focus session" };

    set({ isLoading: true });
    const result = await focusController.disableFocus(session);
    set({ isLoading: false, session: result.success ? null : session });
    if (result.success) invalidateGitBranchQueries(session.mainRepoPath);
    return result;
  },

  restore: async (mainRepoPath) => {
    const session = await focusController.restore(mainRepoPath);
    if (session) set({ session });
  },

  updateSessionBranch: (worktreePath, newBranch) => {
    const { session } = get();
    if (session?.worktreePath === worktreePath) {
      set({ session: { ...session, branch: newBranch } });
    }
  },
}));

export const selectIsLoading = (state: FocusState) => state.isLoading;

export const selectIsFocusedOnWorktree =
  (worktreePath: string) => (state: FocusState) =>
    state.session?.worktreePath === worktreePath;

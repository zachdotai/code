import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";
import { container } from "./di/container";
import { TOKENS } from "./di/tokens";
import {
  checkoutInput,
  findWorktreeInput,
  focusResultSchema,
  focusSessionSchema,
  mainRepoPathInput,
  reattachInput,
  repoPathInput,
  stashInput,
  stashResultSchema,
  syncInput,
  worktreeInput,
} from "./services/focus/schemas";
import type { FocusService } from "./services/focus/service";
import type { FocusSyncService } from "./services/focus/sync-service";
import { listDirectoryInput, listDirectoryOutput } from "./services/fs/schemas";
import type { FsService } from "./services/fs/service";
import { diffStatsInput, diffStatsSchema } from "./services/git/schemas";
import type { GitService } from "./services/git/service";
import {
  resolveGitDirsInput,
  resolveGitDirsOutput,
  watchInput,
  watchRepoInput,
} from "./services/watcher/schemas";
import type { WatcherService } from "./services/watcher/service";

const t = initTRPC.create({ transformer: superjson });

const focusService = () => container.get<FocusService>(TOKENS.FocusService);
const focusSyncService = () =>
  container.get<FocusSyncService>(TOKENS.FocusSyncService);
const gitService = () => container.get<GitService>(TOKENS.GitService);
const fsService = () => container.get<FsService>(TOKENS.FsService);
const watcherService = () =>
  container.get<WatcherService>(TOKENS.WatcherService);

export {
  type FocusBranchRenamedEvent,
  type FocusForeignBranchCheckoutEvent,
  type FocusResult,
  type FocusSession,
  focusBranchRenamedEventSchema,
  focusForeignBranchCheckoutEventSchema,
  focusResultSchema,
  focusSessionSchema,
  type StashResult,
  stashResultSchema,
} from "./services/focus/schemas";
export { type DiffStats, diffStatsSchema } from "./services/git/schemas";
export {
  type FileWatcherEvent,
  FileWatcherEventKind,
} from "./services/watcher/schemas";

export const appRouter = t.router({
  focus: t.router({
    getSession: t.procedure
      .input(mainRepoPathInput)
      .output(focusSessionSchema.nullable())
      .query(({ input }) => focusService().getSession(input.mainRepoPath)),

    saveSession: t.procedure
      .input(focusSessionSchema)
      .mutation(({ input }) => focusService().saveSession(input)),

    deleteSession: t.procedure
      .input(mainRepoPathInput)
      .mutation(({ input }) =>
        focusService().deleteSession(input.mainRepoPath),
      ),

    isFocusActive: t.procedure
      .input(mainRepoPathInput)
      .output(z.boolean())
      .query(({ input }) => focusService().isFocusActive(input.mainRepoPath)),

    isDirty: t.procedure
      .input(repoPathInput)
      .output(z.boolean())
      .query(({ input }) => focusService().isDirty(input.repoPath)),

    getCommitSha: t.procedure
      .input(repoPathInput)
      .output(z.string())
      .query(({ input }) => focusService().getCommitSha(input.repoPath)),

    findWorktreeByBranch: t.procedure
      .input(findWorktreeInput)
      .output(z.string().nullable())
      .query(({ input }) =>
        focusService().findWorktreeByBranch(input.mainRepoPath, input.branch),
      ),

    stash: t.procedure
      .input(stashInput)
      .output(stashResultSchema)
      .mutation(({ input }) =>
        focusService().stash(input.repoPath, input.message),
      ),

    stashPop: t.procedure
      .input(repoPathInput)
      .output(focusResultSchema)
      .mutation(({ input }) => focusService().stashPop(input.repoPath)),

    stashApply: t.procedure
      .input(z.object({ repoPath: z.string(), stashRef: z.string() }))
      .output(focusResultSchema)
      .mutation(({ input }) =>
        focusService().stashApply(input.repoPath, input.stashRef),
      ),

    checkout: t.procedure
      .input(checkoutInput)
      .output(focusResultSchema)
      .mutation(({ input }) =>
        focusService().checkout(input.repoPath, input.branch),
      ),

    detachWorktree: t.procedure
      .input(worktreeInput)
      .output(focusResultSchema)
      .mutation(({ input }) =>
        focusService().detachWorktree(input.worktreePath),
      ),

    reattachWorktree: t.procedure
      .input(reattachInput)
      .output(focusResultSchema)
      .mutation(({ input }) =>
        focusService().reattachWorktree(input.worktreePath, input.branch),
      ),

    cleanWorkingTree: t.procedure
      .input(repoPathInput)
      .mutation(({ input }) => focusService().cleanWorkingTree(input.repoPath)),

    startSync: t.procedure
      .input(syncInput)
      .mutation(({ input }) =>
        focusSyncService().startSync(input.mainRepoPath, input.worktreePath),
      ),

    stopSync: t.procedure.mutation(() => focusSyncService().stopSync()),

    startWatchingMainRepo: t.procedure
      .input(mainRepoPathInput)
      .mutation(({ input }) =>
        focusService().startWatchingMainRepo(input.mainRepoPath),
      ),

    stopWatchingMainRepo: t.procedure.mutation(() =>
      focusService().stopWatchingMainRepo(),
    ),

    onBranchRenamed: t.procedure.subscription(async function* (opts) {
      for await (const event of focusService().branchRenamedEvents(
        opts.signal,
      )) {
        yield event;
      }
    }),

    onForeignBranchCheckout: t.procedure.subscription(async function* (opts) {
      for await (const event of focusService().foreignBranchCheckoutEvents(
        opts.signal,
      )) {
        yield event;
      }
    }),
  }),
  diffStats: t.router({
    getDiffStats: t.procedure
      .input(diffStatsInput)
      .output(diffStatsSchema)
      .query(({ input }) => gitService().getDiffStats(input.directoryPath)),
  }),
  fs: t.router({
    listDirectory: t.procedure
      .input(listDirectoryInput)
      .output(listDirectoryOutput)
      .query(({ input }) => fsService().listDirectory(input.dirPath)),
  }),
  watcher: t.router({
    resolveGitDirs: t.procedure
      .input(resolveGitDirsInput)
      .output(resolveGitDirsOutput)
      .query(({ input }) => watcherService().resolveGitDirs(input.repoPath)),

    watch: t.procedure
      .input(watchInput)
      .subscription(({ input, signal }) =>
        watcherService().watch(input.dirPath, { ignore: input.ignore }, signal),
      ),
  }),
  fileWatcher: t.router({
    watch: t.procedure
      .input(watchRepoInput)
      .subscription(({ input, signal }) =>
        watcherService().watchRepo(input.repoPath, signal),
      ),
  }),
});

export type AppRouter = typeof appRouter;

import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";
import { container } from "./di/container";
import { TOKENS } from "./di/tokens";
import { traceTrpcCall } from "./node-tracing";
import { getWorkspaceServerTracer } from "./otel-trace";
import { connectivityStatusOutput } from "./services/connectivity/schemas";
import type { ConnectivityService } from "./services/connectivity/service";
import {
  createEnvironmentInput,
  deleteEnvironmentInput,
  environmentSchema,
  getEnvironmentInput,
  listEnvironmentsInput,
  updateEnvironmentInput,
} from "./services/environment/schemas";
import type { EnvironmentService } from "./services/environment/service";
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
import {
  boundedReadResult,
  listDirectoryInput,
  listDirectoryOutput,
  listRepoFilesInput,
  listRepoFilesOutput,
  readAbsoluteFileInput,
  readRepoFileBoundedInput,
  readRepoFileInput,
  readRepoFileOutput,
  readRepoFilesBoundedInput,
  readRepoFilesBoundedOutput,
  readRepoFilesInput,
  readRepoFilesOutput,
  writeRepoFileInput,
} from "./services/fs/schemas";
import type { FsService } from "./services/fs/service";
import {
  changedFilesOutput,
  checkoutBranchInput,
  checkoutBranchOutput,
  cleanupAfterCloudHandoffInput,
  cleanupAfterCloudHandoffOutput,
  cloneRepositoryInput,
  cloneRepositoryOutput,
  commitInput,
  commitOutput,
  createBranchInput,
  createPrViaGhInput,
  createPrViaGhOutput,
  detectRepoResultSchema,
  diffInput,
  diffStatsInput,
  diffStatsSchema,
  directoryPathInput,
  discardFileChangesInput,
  discardFileChangesOutput,
  filePathInput,
  getBranchChangedFilesInput,
  getCommitConventionsInput,
  getCommitConventionsOutput,
  getCommitsBetweenBranchesInput,
  getCommitsBetweenBranchesOutput,
  getDiffAgainstRemoteInput,
  getGithubIssueInput,
  getGithubIssueOutput,
  getGithubPullRequestInput,
  getGithubPullRequestOutput,
  getGitSyncStatusInput,
  getHeadShaOutput,
  getLocalBranchChangedFilesInput,
  getPrChangedFilesInput,
  getPrDetailsByUrlInput,
  getPrDetailsByUrlOutput,
  getPrDiffStatsBatchInput,
  getPrDiffStatsBatchOutput,
  getPrReviewCommentsInput,
  getPrReviewCommentsOutput,
  getPrTemplateInput,
  getPrTemplateOutput,
  getPrUrlForBranchInput,
  getPrUrlForBranchOutput,
  ghAuthTokenOutput,
  ghStatusOutput,
  gitBusyStateInput,
  gitBusyStateSchema,
  gitCommitInfoNullableOutput,
  gitRepoInfoNullableOutput,
  gitStateSnapshotSchema,
  gitStatusOutput,
  syncInput as gitSyncInput,
  syncOutput as gitSyncOutput,
  gitSyncStatusSchema,
  openPrInput,
  openPrOutput,
  prStatusOutput,
  publishInput,
  publishOutput,
  pullInput,
  pullOutput,
  pushInput,
  pushOutput,
  readHandoffLocalGitStateInput,
  readHandoffLocalGitStateOutput,
  replyToPrCommentInput,
  replyToPrCommentOutput,
  resetSoftInput,
  resolveReviewThreadInput,
  resolveReviewThreadOutput,
  searchGithubRefsInput,
  searchGithubRefsOutput,
  stageFilesInput,
  stringArrayOutput,
  stringNullableOutput,
  stringOutput,
  updatePrByUrlInput,
  updatePrByUrlOutput,
} from "./services/git/schemas";
import type { GitService } from "./services/git/service";
import {
  countLocalLogEntriesInput,
  countLocalLogEntriesOutput,
  deleteLocalLogCacheInput,
  readLocalLogsInput,
  readLocalLogsOutput,
  seedLocalLogsInput,
  writeLocalLogsInput,
} from "./services/local-logs/schemas";
import type { LocalLogsService } from "./services/local-logs/service";
import {
  resolveGitDirsInput,
  resolveGitDirsOutput,
  watchInput,
  watchRepoInput,
} from "./services/watcher/schemas";
import type { WatcherService } from "./services/watcher/service";

const t = initTRPC.create({ transformer: superjson });

const tracingMiddleware = t.middleware(({ path, type, next }) =>
  traceTrpcCall(getWorkspaceServerTracer(), path, type, next),
);

const tracedProcedure = t.procedure.use(tracingMiddleware);

const focusService = () => container.get<FocusService>(TOKENS.FocusService);
const focusSyncService = () =>
  container.get<FocusSyncService>(TOKENS.FocusSyncService);
const gitService = () => container.get<GitService>(TOKENS.GitService);
const fsService = () => container.get<FsService>(TOKENS.FsService);
const watcherService = () =>
  container.get<WatcherService>(TOKENS.WatcherService);
const localLogsService = () =>
  container.get<LocalLogsService>(TOKENS.LocalLogsService);
const connectivityService = () =>
  container.get<ConnectivityService>(TOKENS.ConnectivityService);
const environmentService = () =>
  container.get<EnvironmentService>(TOKENS.EnvironmentService);

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
    getSession: tracedProcedure
      .input(mainRepoPathInput)
      .output(focusSessionSchema.nullable())
      .query(({ input }) => focusService().getSession(input.mainRepoPath)),

    saveSession: tracedProcedure
      .input(focusSessionSchema)
      .mutation(({ input }) => focusService().saveSession(input)),

    deleteSession: tracedProcedure
      .input(mainRepoPathInput)
      .mutation(({ input }) =>
        focusService().deleteSession(input.mainRepoPath),
      ),

    isFocusActive: tracedProcedure
      .input(mainRepoPathInput)
      .output(z.boolean())
      .query(({ input }) => focusService().isFocusActive(input.mainRepoPath)),

    isDirty: tracedProcedure
      .input(repoPathInput)
      .output(z.boolean())
      .query(({ input }) => focusService().isDirty(input.repoPath)),

    getCommitSha: tracedProcedure
      .input(repoPathInput)
      .output(z.string())
      .query(({ input }) => focusService().getCommitSha(input.repoPath)),

    findWorktreeByBranch: tracedProcedure
      .input(findWorktreeInput)
      .output(z.string().nullable())
      .query(({ input }) =>
        focusService().findWorktreeByBranch(input.mainRepoPath, input.branch),
      ),

    stash: tracedProcedure
      .input(stashInput)
      .output(stashResultSchema)
      .mutation(({ input }) =>
        focusService().stash(input.repoPath, input.message),
      ),

    stashPop: tracedProcedure
      .input(repoPathInput)
      .output(focusResultSchema)
      .mutation(({ input }) => focusService().stashPop(input.repoPath)),

    stashApply: tracedProcedure
      .input(z.object({ repoPath: z.string(), stashRef: z.string() }))
      .output(focusResultSchema)
      .mutation(({ input }) =>
        focusService().stashApply(input.repoPath, input.stashRef),
      ),

    checkout: tracedProcedure
      .input(checkoutInput)
      .output(focusResultSchema)
      .mutation(({ input }) =>
        focusService().checkout(input.repoPath, input.branch),
      ),

    detachWorktree: tracedProcedure
      .input(worktreeInput)
      .output(focusResultSchema)
      .mutation(({ input }) =>
        focusService().detachWorktree(input.worktreePath),
      ),

    reattachWorktree: tracedProcedure
      .input(reattachInput)
      .output(focusResultSchema)
      .mutation(({ input }) =>
        focusService().reattachWorktree(input.worktreePath, input.branch),
      ),

    cleanWorkingTree: tracedProcedure
      .input(repoPathInput)
      .mutation(({ input }) => focusService().cleanWorkingTree(input.repoPath)),

    startSync: tracedProcedure
      .input(syncInput)
      .mutation(({ input }) =>
        focusSyncService().startSync(input.mainRepoPath, input.worktreePath),
      ),

    stopSync: tracedProcedure.mutation(() => focusSyncService().stopSync()),

    startWatchingMainRepo: tracedProcedure
      .input(mainRepoPathInput)
      .mutation(({ input }) =>
        focusService().startWatchingMainRepo(input.mainRepoPath),
      ),

    stopWatchingMainRepo: tracedProcedure.mutation(() =>
      focusService().stopWatchingMainRepo(),
    ),

    onBranchRenamed: tracedProcedure.subscription(async function* (opts) {
      for await (const event of focusService().branchRenamedEvents(
        opts.signal,
      )) {
        yield event;
      }
    }),

    onForeignBranchCheckout: tracedProcedure.subscription(
      async function* (opts) {
        for await (const event of focusService().foreignBranchCheckoutEvents(
          opts.signal,
        )) {
          yield event;
        }
      },
    ),
  }),
  git: t.router({
    detectRepo: tracedProcedure
      .input(directoryPathInput)
      .output(detectRepoResultSchema)
      .query(({ input }) => gitService().detectRepo(input.directoryPath)),

    validateRepo: tracedProcedure
      .input(directoryPathInput)
      .output(z.boolean())
      .query(({ input }) => gitService().validateRepo(input.directoryPath)),

    getRemoteUrl: tracedProcedure
      .input(directoryPathInput)
      .output(stringNullableOutput)
      .query(({ input }) => gitService().getRemoteUrl(input.directoryPath)),

    getCurrentBranch: tracedProcedure
      .input(directoryPathInput)
      .output(stringNullableOutput)
      .query(({ input, signal }) =>
        gitService().getCurrentBranch(input.directoryPath, signal),
      ),

    getDefaultBranch: tracedProcedure
      .input(directoryPathInput)
      .output(stringOutput)
      .query(({ input }) => gitService().getDefaultBranch(input.directoryPath)),

    getAllBranches: tracedProcedure
      .input(directoryPathInput)
      .output(stringArrayOutput)
      .query(({ input, signal }) =>
        gitService().getAllBranches(input.directoryPath, signal),
      ),

    getChangedFilesHead: tracedProcedure
      .input(directoryPathInput)
      .output(changedFilesOutput)
      .query(({ input, signal }) =>
        gitService().getChangedFilesHead(input.directoryPath, signal),
      ),

    getFileAtHead: tracedProcedure
      .input(filePathInput)
      .output(stringNullableOutput)
      .query(({ input, signal }) =>
        gitService().getFileAtHead(input.directoryPath, input.filePath, signal),
      ),

    getDiffHead: tracedProcedure
      .input(diffInput)
      .output(stringOutput)
      .query(({ input, signal }) =>
        gitService().getDiffHead(
          input.directoryPath,
          input.ignoreWhitespace,
          signal,
        ),
      ),

    getDiffCached: tracedProcedure
      .input(diffInput)
      .output(stringOutput)
      .query(({ input, signal }) =>
        gitService().getDiffCached(
          input.directoryPath,
          input.ignoreWhitespace,
          signal,
        ),
      ),

    getDiffUnstaged: tracedProcedure
      .input(diffInput)
      .output(stringOutput)
      .query(({ input, signal }) =>
        gitService().getDiffUnstaged(
          input.directoryPath,
          input.ignoreWhitespace,
          signal,
        ),
      ),

    getLatestCommit: tracedProcedure
      .input(directoryPathInput)
      .output(gitCommitInfoNullableOutput)
      .query(({ input, signal }) =>
        gitService().getLatestCommit(input.directoryPath, signal),
      ),

    getGitRepoInfo: tracedProcedure
      .input(directoryPathInput)
      .output(gitRepoInfoNullableOutput)
      .query(({ input }) => gitService().getGitRepoInfo(input.directoryPath)),

    getGitBusyState: tracedProcedure
      .input(gitBusyStateInput)
      .output(gitBusyStateSchema)
      .query(({ input, signal }) =>
        gitService().getGitBusyState(input.directoryPath, signal),
      ),

    getGitSyncStatus: tracedProcedure
      .input(getGitSyncStatusInput)
      .output(gitSyncStatusSchema)
      .query(({ input }) =>
        gitService().getGitSyncStatus(input.directoryPath, input.forceRefresh),
      ),

    createBranch: tracedProcedure
      .input(createBranchInput)
      .mutation(({ input }) =>
        gitService().createBranch(input.directoryPath, input.branchName),
      ),

    checkoutBranch: tracedProcedure
      .input(checkoutBranchInput)
      .output(checkoutBranchOutput)
      .mutation(({ input }) =>
        gitService().checkoutBranch(input.directoryPath, input.branchName),
      ),

    stageFiles: tracedProcedure
      .input(stageFilesInput)
      .output(gitStateSnapshotSchema)
      .mutation(({ input }) =>
        gitService().stageFiles(input.directoryPath, input.paths),
      ),

    unstageFiles: tracedProcedure
      .input(stageFilesInput)
      .output(gitStateSnapshotSchema)
      .mutation(({ input }) =>
        gitService().unstageFiles(input.directoryPath, input.paths),
      ),

    discardFileChanges: tracedProcedure
      .input(discardFileChangesInput)
      .output(discardFileChangesOutput)
      .mutation(({ input }) =>
        gitService().discardFileChanges(
          input.directoryPath,
          input.filePath,
          input.fileStatus,
        ),
      ),

    push: tracedProcedure
      .input(pushInput)
      .output(pushOutput)
      .mutation(({ input, signal }) =>
        gitService().push(
          input.directoryPath,
          input.remote,
          input.branch,
          input.setUpstream,
          signal,
          input.env,
        ),
      ),

    commit: tracedProcedure
      .input(commitInput)
      .output(commitOutput)
      .mutation(({ input }) =>
        gitService().commit(input.directoryPath, input.message, {
          paths: input.paths,
          allowEmpty: input.allowEmpty,
          stagedOnly: input.stagedOnly,
          env: input.env,
        }),
      ),

    pull: tracedProcedure
      .input(pullInput)
      .output(pullOutput)
      .mutation(({ input, signal }) =>
        gitService().pull(
          input.directoryPath,
          input.remote,
          input.branch,
          signal,
        ),
      ),

    publish: tracedProcedure
      .input(publishInput)
      .output(publishOutput)
      .mutation(({ input, signal }) =>
        gitService().publish(
          input.directoryPath,
          input.remote,
          signal,
          input.env,
        ),
      ),

    sync: tracedProcedure
      .input(gitSyncInput)
      .output(gitSyncOutput)
      .mutation(({ input, signal }) =>
        gitService().sync(input.directoryPath, input.remote, signal),
      ),

    getGhStatus: tracedProcedure
      .output(ghStatusOutput)
      .query(() => gitService().getGhStatus()),

    getGhAuthToken: tracedProcedure
      .output(ghAuthTokenOutput)
      .query(() => gitService().getGhAuthToken()),

    getPrStatus: tracedProcedure
      .input(directoryPathInput)
      .output(prStatusOutput)
      .query(({ input }) => gitService().getPrStatus(input.directoryPath)),

    getPrUrlForBranch: tracedProcedure
      .input(getPrUrlForBranchInput)
      .output(getPrUrlForBranchOutput)
      .query(({ input }) =>
        gitService().getPrUrlForBranch(input.directoryPath, input.branchName),
      ),

    openPr: tracedProcedure
      .input(openPrInput)
      .output(openPrOutput)
      .mutation(({ input }) => gitService().openPr(input.directoryPath)),

    getPrDetailsByUrl: tracedProcedure
      .input(getPrDetailsByUrlInput)
      .output(getPrDetailsByUrlOutput.nullable())
      .query(({ input }) => gitService().getPrDetailsByUrl(input.prUrl)),

    getPrChangedFiles: tracedProcedure
      .input(getPrChangedFilesInput)
      .output(changedFilesOutput)
      .query(({ input }) => gitService().getPrChangedFiles(input.prUrl)),

    getPrDiffStatsBatch: tracedProcedure
      .input(getPrDiffStatsBatchInput)
      .output(getPrDiffStatsBatchOutput)
      .query(({ input }) => gitService().getPrDiffStatsBatch(input.prUrls)),

    getBranchChangedFiles: tracedProcedure
      .input(getBranchChangedFilesInput)
      .output(changedFilesOutput)
      .query(({ input }) =>
        gitService().getBranchChangedFiles(input.repo, input.branch),
      ),

    getLocalBranchChangedFiles: tracedProcedure
      .input(getLocalBranchChangedFilesInput)
      .output(changedFilesOutput)
      .query(({ input }) =>
        gitService().getLocalBranchChangedFiles(
          input.directoryPath,
          input.branch,
        ),
      ),

    updatePrByUrl: tracedProcedure
      .input(updatePrByUrlInput)
      .output(updatePrByUrlOutput)
      .mutation(({ input }) =>
        gitService().updatePrByUrl(input.prUrl, input.action),
      ),

    getPrReviewComments: tracedProcedure
      .input(getPrReviewCommentsInput)
      .output(getPrReviewCommentsOutput)
      .query(({ input }) => gitService().getPrReviewComments(input.prUrl)),

    resolveReviewThread: tracedProcedure
      .input(resolveReviewThreadInput)
      .output(resolveReviewThreadOutput)
      .mutation(({ input }) =>
        gitService().resolveReviewThread(input.threadNodeId, input.resolved),
      ),

    replyToPrComment: tracedProcedure
      .input(replyToPrCommentInput)
      .output(replyToPrCommentOutput)
      .mutation(({ input }) =>
        gitService().replyToPrComment(input.prUrl, input.commentId, input.body),
      ),

    getPrTemplate: tracedProcedure
      .input(getPrTemplateInput)
      .output(getPrTemplateOutput)
      .query(({ input }) => gitService().getPrTemplate(input.directoryPath)),

    getCommitConventions: tracedProcedure
      .input(getCommitConventionsInput)
      .output(getCommitConventionsOutput)
      .query(({ input }) =>
        gitService().getCommitConventions(
          input.directoryPath,
          input.sampleSize,
        ),
      ),

    searchGithubRefs: tracedProcedure
      .input(searchGithubRefsInput)
      .output(searchGithubRefsOutput)
      .query(({ input }) =>
        gitService().searchGithubRefs(
          input.directoryPath,
          input.query,
          input.limit,
          input.kinds,
        ),
      ),

    getGithubIssue: tracedProcedure
      .input(getGithubIssueInput)
      .output(getGithubIssueOutput)
      .query(({ input }) =>
        gitService().getGithubIssue(input.owner, input.repo, input.number),
      ),

    getGithubPullRequest: tracedProcedure
      .input(getGithubPullRequestInput)
      .output(getGithubPullRequestOutput)
      .query(({ input }) =>
        gitService().getGithubPullRequest(
          input.owner,
          input.repo,
          input.number,
        ),
      ),

    readHandoffLocalGitState: tracedProcedure
      .input(readHandoffLocalGitStateInput)
      .output(readHandoffLocalGitStateOutput)
      .query(({ input }) =>
        gitService().readHandoffLocalGitState(input.directoryPath),
      ),

    cleanupAfterCloudHandoff: tracedProcedure
      .input(cleanupAfterCloudHandoffInput)
      .output(cleanupAfterCloudHandoffOutput)
      .mutation(({ input }) =>
        gitService().cleanupAfterCloudHandoff(
          input.directoryPath,
          input.branchName,
        ),
      ),

    getDiffStats: tracedProcedure
      .input(diffStatsInput)
      .output(diffStatsSchema)
      .query(({ input }) => gitService().getDiffStats(input.directoryPath)),

    getGitStatus: tracedProcedure
      .output(gitStatusOutput)
      .query(() => gitService().getGitStatus()),

    getHeadSha: tracedProcedure
      .input(directoryPathInput)
      .output(getHeadShaOutput)
      .query(({ input }) => gitService().getHeadSha(input.directoryPath)),

    getDiffAgainstRemote: tracedProcedure
      .input(getDiffAgainstRemoteInput)
      .output(stringOutput)
      .query(({ input }) =>
        gitService().getDiffAgainstRemote(
          input.directoryPath,
          input.baseBranch,
        ),
      ),

    getCommitsBetweenBranches: tracedProcedure
      .input(getCommitsBetweenBranchesInput)
      .output(getCommitsBetweenBranchesOutput)
      .query(({ input }) =>
        gitService().getCommitsBetweenBranches(
          input.directoryPath,
          input.baseBranch,
          input.head,
          input.limit,
        ),
      ),

    resetSoft: tracedProcedure
      .input(resetSoftInput)
      .mutation(({ input }) =>
        gitService().resetSoft(input.directoryPath, input.sha),
      ),

    createPrViaGh: tracedProcedure
      .input(createPrViaGhInput)
      .output(createPrViaGhOutput)
      .mutation(({ input }) =>
        gitService().createPrViaGh(
          input.directoryPath,
          input.title,
          input.body,
          input.draft,
          input.env,
        ),
      ),

    cloneRepository: tracedProcedure
      .input(cloneRepositoryInput)
      .output(cloneRepositoryOutput)
      .mutation(({ input }) =>
        gitService().cloneRepository(
          input.repoUrl,
          input.targetPath,
          input.cloneId,
        ),
      ),

    onCloneProgress: tracedProcedure.subscription(async function* (opts) {
      for await (const data of gitService().toIterable("cloneProgress", {
        signal: opts.signal,
      })) {
        yield data;
      }
    }),
  }),
  diffStats: t.router({
    getDiffStats: tracedProcedure
      .input(diffStatsInput)
      .output(diffStatsSchema)
      .query(({ input }) => gitService().getDiffStats(input.directoryPath)),
  }),
  fs: t.router({
    listDirectory: tracedProcedure
      .input(listDirectoryInput)
      .output(listDirectoryOutput)
      .query(({ input }) => fsService().listDirectory(input.dirPath)),

    listRepoFiles: tracedProcedure
      .input(listRepoFilesInput)
      .output(listRepoFilesOutput)
      .query(({ input }) =>
        fsService().listRepoFiles(input.repoPath, input.query, input.limit),
      ),

    readRepoFile: tracedProcedure
      .input(readRepoFileInput)
      .output(readRepoFileOutput)
      .query(({ input }) =>
        fsService().readRepoFile(input.repoPath, input.filePath),
      ),

    readRepoFiles: tracedProcedure
      .input(readRepoFilesInput)
      .output(readRepoFilesOutput)
      .query(({ input }) =>
        fsService().readRepoFiles(input.repoPath, input.filePaths),
      ),

    readRepoFileBounded: tracedProcedure
      .input(readRepoFileBoundedInput)
      .output(boundedReadResult)
      .query(({ input }) =>
        fsService().readRepoFileBounded(
          input.repoPath,
          input.filePath,
          input.maxLines,
        ),
      ),

    readRepoFilesBounded: tracedProcedure
      .input(readRepoFilesBoundedInput)
      .output(readRepoFilesBoundedOutput)
      .query(({ input }) =>
        fsService().readRepoFilesBounded(
          input.repoPath,
          input.filePaths,
          input.maxLines,
        ),
      ),

    readAbsoluteFile: tracedProcedure
      .input(readAbsoluteFileInput)
      .output(readRepoFileOutput)
      .query(({ input }) => fsService().readAbsoluteFile(input.filePath)),

    readFileAsBase64: tracedProcedure
      .input(readAbsoluteFileInput)
      .output(readRepoFileOutput)
      .query(({ input }) => fsService().readFileAsBase64(input.filePath)),

    writeRepoFile: tracedProcedure
      .input(writeRepoFileInput)
      .mutation(({ input }) =>
        fsService().writeRepoFile(
          input.repoPath,
          input.filePath,
          input.content,
        ),
      ),
  }),
  watcher: t.router({
    resolveGitDirs: tracedProcedure
      .input(resolveGitDirsInput)
      .output(resolveGitDirsOutput)
      .query(({ input }) => watcherService().resolveGitDirs(input.repoPath)),

    watch: tracedProcedure
      .input(watchInput)
      .subscription(({ input, signal }) =>
        watcherService().watch(input.dirPath, { ignore: input.ignore }, signal),
      ),
  }),
  fileWatcher: t.router({
    watch: tracedProcedure
      .input(watchRepoInput)
      .subscription(({ input, signal }) =>
        watcherService().watchRepo(input.repoPath, signal),
      ),
  }),
  localLogs: t.router({
    read: tracedProcedure
      .input(readLocalLogsInput)
      .output(readLocalLogsOutput)
      .query(({ input }) => localLogsService().readLocalLogs(input.taskRunId)),

    write: tracedProcedure
      .input(writeLocalLogsInput)
      .mutation(({ input }) =>
        localLogsService().writeLocalLogs(input.taskRunId, input.content),
      ),

    seed: tracedProcedure
      .input(seedLocalLogsInput)
      .mutation(({ input }) =>
        localLogsService().seedLocalLogs(input.taskRunId, input.content),
      ),

    count: tracedProcedure
      .input(countLocalLogEntriesInput)
      .output(countLocalLogEntriesOutput)
      .query(({ input }) =>
        localLogsService().countLocalLogEntries(input.taskRunId),
      ),

    delete: tracedProcedure
      .input(deleteLocalLogCacheInput)
      .mutation(({ input }) =>
        localLogsService().deleteLocalLogCache(input.taskRunId),
      ),
  }),
  connectivity: t.router({
    getStatus: tracedProcedure
      .output(connectivityStatusOutput)
      .query(() => connectivityService().getStatus()),

    checkNow: tracedProcedure
      .output(connectivityStatusOutput)
      .mutation(() => connectivityService().checkNow()),

    onStatusChange: tracedProcedure.subscription(async function* (opts) {
      for await (const status of connectivityService().statusChangeEvents(
        opts.signal,
      )) {
        yield status;
      }
    }),
  }),
  environment: t.router({
    list: tracedProcedure
      .input(listEnvironmentsInput)
      .output(environmentSchema.array())
      .query(({ input }) =>
        environmentService().listEnvironments(input.repoPath),
      ),

    get: tracedProcedure
      .input(getEnvironmentInput)
      .output(environmentSchema.nullable())
      .query(({ input }) =>
        environmentService().getEnvironment(input.repoPath, input.id),
      ),

    create: tracedProcedure
      .input(createEnvironmentInput)
      .output(environmentSchema)
      .mutation(({ input }) => {
        const { repoPath, ...rest } = input;
        return environmentService().createEnvironment(rest, repoPath);
      }),

    update: tracedProcedure
      .input(updateEnvironmentInput)
      .output(environmentSchema)
      .mutation(({ input }) => {
        const { repoPath, ...rest } = input;
        return environmentService().updateEnvironment(rest, repoPath);
      }),

    delete: tracedProcedure
      .input(deleteEnvironmentInput)
      .mutation(({ input }) =>
        environmentService().deleteEnvironment(input.repoPath, input.id),
      ),
  }),
});

export type AppRouter = typeof appRouter;

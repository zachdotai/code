// PORT NOTE: shim — delegates host operations to workspace-server and keeps
// local focus-session persistence in Electron. Delete when focus session
// persistence also moves out of main.
import fs from "node:fs/promises";
import path from "node:path";
import type { WorkspaceClient } from "@posthog/workspace-client/client";
import type { FocusBranchRenamedEvent } from "@posthog/workspace-client/types";
import { type FocusSession, focusStore } from "../../utils/store";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import { getWorktreeLocation } from "../settingsStore";
import type { FocusResult, StashResult } from "./schemas";

export const FocusServiceEvent = {
  BranchRenamed: "branchRenamed",
  ForeignBranchCheckout: "foreignBranchCheckout",
} as const;

export interface FocusServiceEvents {
  [FocusServiceEvent.BranchRenamed]: {
    mainRepoPath: string;
    worktreePath: string;
    oldBranch: string;
    newBranch: string;
  };
  [FocusServiceEvent.ForeignBranchCheckout]: {
    mainRepoPath: string;
    worktreePath: string;
    focusedBranch: string;
    foreignBranch: string;
  };
}

export class FocusService extends TypedEventEmitter<FocusServiceEvents> {
  constructor(private readonly workspace: WorkspaceClient) {
    super();
    this.workspace.focus.onBranchRenamed.subscribe(undefined, {
      onData: (event) => {
        void this.handleBranchRenamed(event);
      },
      onError: () => {},
    });
    this.workspace.focus.onForeignBranchCheckout.subscribe(undefined, {
      onData: (event) => {
        this.emit(FocusServiceEvent.ForeignBranchCheckout, event);
      },
      onError: () => {},
    });
  }

  getSession(mainRepoPath: string): FocusSession | null {
    const sessions = focusStore.get("sessions", {});
    return sessions[mainRepoPath] ?? null;
  }

  async saveSession(session: FocusSession): Promise<void> {
    const sessions = focusStore.get("sessions", {});
    sessions[session.mainRepoPath] = session;
    focusStore.set("sessions", sessions);
    await this.workspace.focus.saveSession.mutate(session);
  }

  async deleteSession(mainRepoPath: string): Promise<void> {
    const sessions = focusStore.get("sessions", {});
    delete sessions[mainRepoPath];
    focusStore.set("sessions", sessions);
    await this.workspace.focus.deleteSession.mutate({ mainRepoPath });
  }

  isFocusActive(mainRepoPath: string): boolean {
    return this.getSession(mainRepoPath) !== null;
  }

  validateFocusOperation(
    currentBranch: string | null,
    targetBranch: string,
  ): string | null {
    if (!currentBranch) {
      return "Cannot focus: main repo is in detached HEAD state.";
    }
    if (currentBranch === targetBranch) {
      return `Cannot focus: already on branch "${targetBranch}".`;
    }
    return null;
  }

  async getCommitSha(repoPath: string): Promise<string> {
    return await this.workspace.focus.getCommitSha.query({ repoPath });
  }

  async findWorktreeByBranch(
    mainRepoPath: string,
    branch: string,
  ): Promise<string | null> {
    return await this.workspace.focus.findWorktreeByBranch.query({
      mainRepoPath,
      branch,
    });
  }

  toRelativeWorktreePath(absolutePath: string, mainRepoPath: string): string {
    const repoName = path.basename(mainRepoPath);
    const worktreeName = path.basename(absolutePath);
    return `${repoName}/${worktreeName}`;
  }

  toAbsoluteWorktreePath(relativePath: string): string {
    return path.join(getWorktreeLocation(), relativePath);
  }

  async worktreeExistsAtPath(relativePath: string): Promise<boolean> {
    const absolutePath = this.toAbsoluteWorktreePath(relativePath);
    try {
      await fs.access(absolutePath);
      return true;
    } catch {
      return false;
    }
  }

  async cleanWorkingTree(repoPath: string): Promise<void> {
    await this.workspace.focus.cleanWorkingTree.mutate({ repoPath });
  }

  async detachWorktree(worktreePath: string): Promise<FocusResult> {
    return await this.workspace.focus.detachWorktree.mutate({ worktreePath });
  }

  async reattachWorktree(
    worktreePath: string,
    branchName: string,
  ): Promise<FocusResult> {
    return await this.workspace.focus.reattachWorktree.mutate({
      worktreePath,
      branch: branchName,
    });
  }

  async isDirty(repoPath: string): Promise<boolean> {
    return await this.workspace.focus.isDirty.query({ repoPath });
  }

  async stash(repoPath: string, message: string): Promise<StashResult> {
    return await this.workspace.focus.stash.mutate({ repoPath, message });
  }

  async stashApply(repoPath: string, stashRef: string): Promise<FocusResult> {
    return await this.workspace.focus.stashApply.mutate({ repoPath, stashRef });
  }

  async stashPop(repoPath: string): Promise<FocusResult> {
    return await this.workspace.focus.stashPop.mutate({ repoPath });
  }

  async checkout(repoPath: string, branch: string): Promise<FocusResult> {
    return await this.workspace.focus.checkout.mutate({ repoPath, branch });
  }

  async startSync(mainRepoPath: string, worktreePath: string): Promise<void> {
    await this.workspace.focus.startSync.mutate({ mainRepoPath, worktreePath });
  }

  async stopSync(): Promise<void> {
    await this.workspace.focus.stopSync.mutate();
  }

  async startWatchingMainRepo(mainRepoPath: string): Promise<void> {
    await this.workspace.focus.startWatchingMainRepo.mutate({ mainRepoPath });
  }

  async stopWatchingMainRepo(): Promise<void> {
    await this.workspace.focus.stopWatchingMainRepo.mutate();
  }

  private async handleBranchRenamed(
    event: FocusBranchRenamedEvent,
  ): Promise<void> {
    const remoteSession = await this.workspace.focus.getSession
      .query({ mainRepoPath: event.mainRepoPath })
      .catch(() => null);
    const localSession = this.getSession(event.mainRepoPath);
    const sessionToPersist =
      remoteSession ??
      (localSession
        ? {
            ...localSession,
            branch: event.newBranch,
          }
        : null);

    if (sessionToPersist) {
      const sessions = focusStore.get("sessions", {});
      sessions[event.mainRepoPath] = sessionToPersist;
      focusStore.set("sessions", sessions);
    }

    this.emit(FocusServiceEvent.BranchRenamed, event);
  }
}

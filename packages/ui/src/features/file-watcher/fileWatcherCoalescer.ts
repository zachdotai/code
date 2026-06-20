export interface FileWatcherActions {
  invalidateFile(relativePath: string): void;
  closeTabsForFile(relativePath: string): void;
  invalidateGitBranch(): void;
  invalidateGitWorkingTree(): void;
}

export interface FileWatcherCoalescer {
  fileChanged(relativePath: string): void;
  fileDeleted(relativePath: string): void;
  gitStateChanged(): void;
  workingTreeChanged(): void;
  dispose(): void;
}

export function createFileWatcherCoalescer(
  actions: FileWatcherActions,
  delayMs = 250,
): FileWatcherCoalescer {
  const changedFiles = new Set<string>();
  const deletedFiles = new Set<string>();
  let gitState = false;
  let workingTree = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush() {
    timer = null;
    for (const path of changedFiles) actions.invalidateFile(path);
    changedFiles.clear();
    for (const path of deletedFiles) actions.closeTabsForFile(path);
    deletedFiles.clear();
    if (gitState) {
      actions.invalidateGitBranch();
      gitState = false;
    }
    if (workingTree) {
      actions.invalidateGitWorkingTree();
      workingTree = false;
    }
  }

  function schedule() {
    if (timer === null) timer = setTimeout(flush, delayMs);
  }

  return {
    fileChanged(relativePath: string) {
      changedFiles.add(relativePath);
      schedule();
    },
    fileDeleted(relativePath: string) {
      deletedFiles.add(relativePath);
      schedule();
    },
    gitStateChanged() {
      gitState = true;
      schedule();
    },
    workingTreeChanged() {
      workingTree = true;
      schedule();
    },
    dispose() {
      if (timer !== null) {
        clearTimeout(timer);
        flush();
      }
    },
  };
}

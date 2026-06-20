import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFileWatcherCoalescer,
  type FileWatcherActions,
  type FileWatcherCoalescer,
} from "./fileWatcherCoalescer";

function makeActions() {
  const calls = {
    invalidateFile: [] as string[],
    closeTabsForFile: [] as string[],
    invalidateGitBranch: 0,
    invalidateGitWorkingTree: 0,
  };
  const actions: FileWatcherActions = {
    invalidateFile: (p) => calls.invalidateFile.push(p),
    closeTabsForFile: (p) => calls.closeTabsForFile.push(p),
    invalidateGitBranch: () => {
      calls.invalidateGitBranch++;
    },
    invalidateGitWorkingTree: () => {
      calls.invalidateGitWorkingTree++;
    },
  };
  return { actions, calls };
}

describe("createFileWatcherCoalescer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not flush before the window elapses", () => {
    const { actions, calls } = makeActions();
    const c = createFileWatcherCoalescer(actions, 250);
    c.gitStateChanged();
    vi.advanceTimersByTime(249);
    expect(calls.invalidateGitBranch).toBe(0);
    vi.advanceTimersByTime(1);
    expect(calls.invalidateGitBranch).toBe(1);
  });

  it.each([
    {
      name: "collapses repeated git-state events into one branch invalidation",
      drive: (c: FileWatcherCoalescer) => {
        c.gitStateChanged();
        c.gitStateChanged();
        c.gitStateChanged();
      },
      expected: { gitBranch: 1, gitWorkingTree: 0, files: [], closed: [] },
    },
    {
      name: "collapses repeated working-tree events into one invalidation",
      drive: (c: FileWatcherCoalescer) => {
        c.workingTreeChanged();
        c.workingTreeChanged();
      },
      expected: { gitBranch: 0, gitWorkingTree: 1, files: [], closed: [] },
    },
    {
      name: "dedupes per-file invalidations by path",
      drive: (c: FileWatcherCoalescer) => {
        c.fileChanged("a.ts");
        c.fileChanged("b.ts");
        c.fileChanged("a.ts");
      },
      expected: {
        gitBranch: 0,
        gitWorkingTree: 0,
        files: ["a.ts", "b.ts"],
        closed: [],
      },
    },
    {
      name: "coalesces a mixed burst into one flush",
      drive: (c: FileWatcherCoalescer) => {
        c.fileChanged("a.ts");
        c.gitStateChanged();
        c.workingTreeChanged();
        c.fileDeleted("gone.ts");
        c.gitStateChanged();
      },
      expected: {
        gitBranch: 1,
        gitWorkingTree: 1,
        files: ["a.ts"],
        closed: ["gone.ts"],
      },
    },
  ] as const)("$name", ({ drive, expected }) => {
    const { actions, calls } = makeActions();
    const c = createFileWatcherCoalescer(actions, 250);
    drive(c);
    vi.advanceTimersByTime(250);
    expect(calls.invalidateGitBranch).toBe(expected.gitBranch);
    expect(calls.invalidateGitWorkingTree).toBe(expected.gitWorkingTree);
    expect(calls.invalidateFile).toEqual(expected.files);
    expect(calls.closeTabsForFile).toEqual(expected.closed);
  });

  it("flushes a continuous stream every window rather than starving", () => {
    const { actions, calls } = makeActions();
    const c = createFileWatcherCoalescer(actions, 250);
    c.gitStateChanged();
    vi.advanceTimersByTime(250);
    expect(calls.invalidateGitBranch).toBe(1);
    c.gitStateChanged();
    vi.advanceTimersByTime(250);
    expect(calls.invalidateGitBranch).toBe(2);
  });

  it("flushes pending work on dispose so a teardown mid-window drops nothing", () => {
    const { actions, calls } = makeActions();
    const c = createFileWatcherCoalescer(actions, 250);
    c.gitStateChanged();
    c.fileChanged("a.ts");
    c.dispose();
    expect(calls.invalidateGitBranch).toBe(1);
    expect(calls.invalidateFile).toEqual(["a.ts"]);
    vi.advanceTimersByTime(1000);
    expect(calls.invalidateGitBranch).toBe(1);
    expect(calls.invalidateFile).toEqual(["a.ts"]);
  });

  it("dispose with no pending work does nothing", () => {
    const { actions, calls } = makeActions();
    const c = createFileWatcherCoalescer(actions, 250);
    c.dispose();
    vi.advanceTimersByTime(1000);
    expect(calls.invalidateGitBranch).toBe(0);
    expect(calls.invalidateFile).toEqual([]);
  });
});

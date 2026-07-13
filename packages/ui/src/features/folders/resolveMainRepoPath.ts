import type { RegisteredFolder } from "./types";

/**
 * Resolve a registered worktree path to its registered main clone. Returns
 * the input path when it isn't a registered worktree or its main clone isn't
 * itself registered (then the worktree is the repo's only selectable entry).
 *
 * Worktree-mode task creation must target a main repo, so any surface that
 * feeds a user-selected folder into it should normalize through this.
 */
export function resolveMainRepoPath(
  folders: RegisteredFolder[],
  path: string,
): string {
  const mainRepoPath = folders.find((f) => f.path === path)?.mainRepoPath;
  return mainRepoPath && folders.some((f) => f.path === mainRepoPath)
    ? mainRepoPath
    : path;
}

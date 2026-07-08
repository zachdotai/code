import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { delimiter, join } from "node:path";
import { isNodeShimScript } from "@posthog/shared/node-shim";

// Removes PATH entries that alias `node` to the current executable, whether a
// legacy symlink or either wrapper-script variant written by ensureNodeShim.
// Codex children must not resolve `node` through the shim: with the Electron
// fallback engaged, native modules they install target the wrong ABI. A
// real-node-backed shim would be harmless, but stripping it too keeps codex
// on the user's own PATH resolution (detection only ever picks a node that is
// independently reachable there).
export function stripElectronNodeShimFromPath(
  pathValue: string | undefined,
  execPath: string = process.execPath,
): string | undefined {
  if (!pathValue) return pathValue;
  return pathValue
    .split(delimiter)
    .filter((dir) => dir && !isElectronNodeShimDir(dir, execPath))
    .join(delimiter);
}

function isElectronNodeShimDir(dir: string, execPath: string): boolean {
  const shimPath = join(dir, "node");
  try {
    if (lstatSync(shimPath).isSymbolicLink()) {
      return readlinkSync(shimPath) === execPath;
    }
    return isNodeShimScript(readFileSync(shimPath, "utf-8"), execPath);
  } catch {
    return false;
  }
}

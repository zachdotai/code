import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export interface NodeShimOptions {
  /**
   * Absolute path to a real standalone Node binary bundled with the app.
   * When present the shim points at it and no environment variable is
   * involved at all. When absent (dev builds before download-binaries has
   * run) the shim falls back to the app binary in run-as-node mode.
   */
  vendoredNodePath?: string | null;
  platform?: NodeJS.Platform;
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

function escapeForDoubleQuotes(path: string): string {
  return path.replace(/([$`"\\])/g, "\\$1");
}

/**
 * Fallback wrapper for hosts without a vendored runtime: exec the app binary
 * as Node. The script exports ELECTRON_RUN_AS_NODE itself so the shim stays a
 * node runtime even when a layer in between (user dotfiles, direnv/flox,
 * shell snapshots, MCP clients with cleaned envs) strips the var. A bare
 * symlink relied on every descendant preserving the env and booted the full
 * desktop app whenever one didn't.
 */
export function buildNodeShimScript(execPath: string): string {
  return [
    "#!/bin/sh",
    "export ELECTRON_RUN_AS_NODE=1",
    `exec "${escapeForDoubleQuotes(execPath)}" "$@"`,
    "",
  ].join("\n");
}

function buildWindowsCmdShim(nodePath: string): string {
  return `@echo off\r\n"${nodePath}" %*\r\n`;
}

/**
 * Writes the `node` shim agents resolve via PATH. Prefers a symlink to the
 * vendored real Node runtime; falls back to a self-contained run-as-node
 * wrapper around the app binary. Replaces a stale legacy symlink, a wrapper
 * pointing at a moved binary, or a fallback wrapper once the vendored
 * runtime becomes available; no-op when already current.
 */
export function ensureNodeShim(
  mockNodeDir: string,
  appExecPath: string,
  options: NodeShimOptions = {},
): void {
  const platform = options.platform ?? process.platform;
  const vendoredNodePath = options.vendoredNodePath ?? null;
  mkdirSync(mockNodeDir, { recursive: true });
  const shimPath = join(mockNodeDir, "node");

  if (platform === "win32") {
    ensureWindowsShim(mockNodeDir, shimPath, appExecPath, vendoredNodePath);
    return;
  }

  if (vendoredNodePath) {
    ensureSymlink(shimPath, vendoredNodePath);
    return;
  }

  ensureWrapperScript(shimPath, buildNodeShimScript(appExecPath));
}

function ensureWindowsShim(
  mockNodeDir: string,
  shimPath: string,
  appExecPath: string,
  vendoredNodePath: string | null,
): void {
  if (vendoredNodePath) {
    // cmd/PowerShell resolve `node` through PATHEXT, so the shim must be a
    // .cmd file; the extensionless legacy symlink was never resolvable there.
    const cmdPath = join(mockNodeDir, "node.cmd");
    ensureFileContent(cmdPath, buildWindowsCmdShim(vendoredNodePath));
    rmSync(shimPath, { force: true });
    return;
  }

  try {
    symlinkSync(appExecPath, shimPath);
  } catch (err) {
    if (!isErrnoException(err) || err.code !== "EEXIST") throw err;
  }
}

function ensureSymlink(shimPath: string, target: string): void {
  if (currentSymlinkTarget(shimPath) === target) return;

  const tmpPath = `${shimPath}.${process.pid}.tmp`;
  rmSync(tmpPath, { force: true });
  symlinkSync(target, tmpPath);
  renameSync(tmpPath, shimPath);
}

function ensureWrapperScript(shimPath: string, script: string): void {
  if (currentFileContent(shimPath) === script) return;

  const tmpPath = `${shimPath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, script);
  chmodSync(tmpPath, 0o755);
  renameSync(tmpPath, shimPath);
}

function ensureFileContent(filePath: string, content: string): void {
  if (currentFileContent(filePath) === content) return;

  const tmpPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, content);
  renameSync(tmpPath, filePath);
}

function currentSymlinkTarget(shimPath: string): string | null {
  try {
    if (!lstatSync(shimPath).isSymbolicLink()) return null;
    return readlinkSync(shimPath);
  } catch {
    return null;
  }
}

function currentFileContent(filePath: string): string | null {
  try {
    if (lstatSync(filePath).isSymbolicLink()) return null;
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

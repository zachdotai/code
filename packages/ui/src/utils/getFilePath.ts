import { resolveServiceOptional } from "@posthog/di/container";

export interface FilePathResolver {
  resolve(file: File): string | undefined;
}

export const FILE_PATH_RESOLVER = Symbol.for("posthog.ui.FilePathResolver");

export function getFilePath(file: File): string {
  // Optional: only desktop binds a resolver (Electron's webUtils.getPathForFile).
  // Cloud-only hosts (web) don't — a browser's dropped File objects have no OS
  // path — so the resolver is absent and callers fall back to reading bytes.
  const resolved =
    resolveServiceOptional<FilePathResolver>(FILE_PATH_RESOLVER)?.resolve(file);
  if (resolved) return resolved;
  return (file as File & { path?: string }).path ?? "";
}

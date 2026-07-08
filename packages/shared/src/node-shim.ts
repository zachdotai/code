function escapeForDoubleQuotes(path: string): string {
  return path.replace(/([$`"\\])/g, "\\$1");
}

function fallbackBlock(execPath: string): string {
  return [
    "export ELECTRON_RUN_AS_NODE=1",
    `exec "${escapeForDoubleQuotes(execPath)}" "$@"`,
    "",
  ].join("\n");
}

// Single source of truth for the PATH `node` shim format: workspace-server
// writes it and the codex spawn path detects it via isNodeShimScript.
//
// With a realNodePath the shim prefers that binary and only falls back to
// running the app binary as node when it has gone missing — e.g. an nvm
// prune deleted the version between sessions.
export function buildNodeShimScript(
  execPath: string,
  realNodePath?: string,
): string {
  if (!realNodePath) {
    return `#!/bin/sh\n${fallbackBlock(execPath)}`;
  }
  const real = escapeForDoubleQuotes(realNodePath);
  return [
    "#!/bin/sh",
    `if [ -x "${real}" ]; then`,
    `  exec "${real}" "$@"`,
    "fi",
    fallbackBlock(execPath),
  ].join("\n");
}

// True for any shim variant written for the given app binary, with or
// without an embedded preferred real node — detectors (the codex PATH strip,
// real-node discovery) can't know which real node path a shim embeds, so
// they match on the fallback block every variant ends with.
export function isNodeShimScript(content: string, execPath: string): boolean {
  return (
    content.startsWith("#!/bin/sh\n") &&
    content.endsWith(fallbackBlock(execPath))
  );
}

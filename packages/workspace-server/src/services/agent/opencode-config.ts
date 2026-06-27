import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isSafePathSegment } from "../skills/skill-discovery";

/**
 * Resolves a task run's private opencode config/state directory. Each run gets
 * its own so the generated opencode.json and isolated XDG state (db, cache,
 * sessions) never touch the user's global ~/.local/share/opencode db — sharing
 * it triggers schema-mismatch crashes and risks corrupting real sessions.
 */
export function getOpencodeConfigDir(
  appDataPath: string,
  taskRunId: string,
): string {
  if (!isSafePathSegment(taskRunId)) {
    throw new Error(`Unsafe taskRunId: ${JSON.stringify(taskRunId)}`);
  }
  return path.join(appDataPath, "opencode-config", taskRunId);
}

/**
 * Builds a fresh run-private config dir for opencode. The opencode.json itself
 * is written by the agent's spawn step; this just guarantees a clean directory.
 */
export async function prepareOpencodeConfig(options: {
  appDataPath: string;
  taskRunId: string;
}): Promise<string> {
  const dir = getOpencodeConfigDir(options.appDataPath, options.taskRunId);
  // A retried run reuses its taskRunId, so wipe stale config/state first.
  await fs.promises.rm(dir, { recursive: true, force: true });
  await fs.promises.mkdir(dir, { recursive: true });
  return dir;
}

/** Removes a run's private opencode dir. No-op when it was never created. */
export async function cleanupOpencodeConfig(
  appDataPath: string,
  taskRunId: string,
): Promise<void> {
  await fs.promises.rm(getOpencodeConfigDir(appDataPath, taskRunId), {
    recursive: true,
    force: true,
  });
}

function findNpxOpencodeBinaries(): string[] {
  // Dev convenience: a developer who has run `npx opencode-ai` has the native
  // binary cached here. Empty in a shipped app (no npx), where the bundled
  // binary or OPENCODE_BIN is used instead.
  const triple = `opencode-${process.platform}-${process.arch}`;
  const npxRoot = path.join(os.homedir(), ".npm", "_npx");
  const found: string[] = [];
  try {
    for (const dir of fs.readdirSync(npxRoot)) {
      const p = path.join(
        npxRoot,
        dir,
        "node_modules",
        triple,
        "bin",
        "opencode",
      );
      if (fs.existsSync(p)) found.push(p);
    }
  } catch {
    // npx cache absent — fine.
  }
  return found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

/**
 * Resolves the native `opencode` binary to spawn. The `opencode-ai` npm launcher
 * mangles ACP-over-stdio when spawned as a subprocess, so the native binary must
 * be invoked directly. Preference: bundled binary, then `OPENCODE_BIN`, then a
 * dev fallback (freshest npx-cached binary, then a stable `~/.opencode` install).
 * Returns undefined when none exists — the spawn then throws a clear error.
 */
export function resolveOpencodeBinaryPath(
  bundledPath: string | undefined,
): string | undefined {
  const candidates = [
    bundledPath,
    process.env.OPENCODE_BIN,
    ...findNpxOpencodeBinaries(),
    path.join(os.homedir(), ".opencode", "bin", "opencode"),
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => fs.existsSync(p));
}

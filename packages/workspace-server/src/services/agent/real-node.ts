import { execFile } from "node:child_process";
import {
  accessSync,
  constants,
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { isNodeShimScript } from "@posthog/shared/node-shim";

const execFileAsync = promisify(execFile);

/**
 * Oldest node major the shim will prefer over Electron's run-as-node mode.
 * Anything the agent spawns by name (npx MCP servers, hooks, project
 * scripts) broadly assumes an active or maintenance LTS; an older real node
 * is more likely to break those spawns than the Electron fallback is.
 */
export const MIN_REAL_NODE_MAJOR = 20;

/**
 * Bounds a PATH walk full of broken candidates: at most this many probes run
 * before detection gives up and the shim keeps its Electron fallback.
 */
export const MAX_PROBED_CANDIDATES = 5;

const PROBE_TIMEOUT_MS = 2000;

/** Shim scripts are well under this; anything bigger is a real binary. */
const MAX_SHIM_SCRIPT_BYTES = 4096;

// Prints one JSON line identifying the runtime. process.versions.electron is
// non-null when the candidate is itself an Electron binary running as node —
// those are rejected: their addon ABI differs from real node's, which is the
// main failure the real-node preference exists to avoid.
const PROBE_EXPRESSION =
  "JSON.stringify({node:process.version,electron:process.versions.electron??null})";

export interface RealNode {
  path: string;
  version: string;
}

export interface FindRealNodeOptions {
  env?: NodeJS.ProcessEnv;
  execPath?: string;
  platform?: NodeJS.Platform;
  probeTimeoutMs?: number;
  /** Surfaces non-fatal detection problems (e.g. a bad explicit override). */
  warn?: (message: string, data?: Record<string, unknown>) => void;
  /** Test seam: replaces the child-process probe. */
  probe?: (candidatePath: string) => Promise<RealNode | null>;
}

/**
 * Finds a real Node.js runtime for the PATH shim to prefer over running the
 * app binary in run-as-node mode. Resolution order: the
 * POSTHOG_CODE_NODE_PATH override, then the first PATH entry whose `node`
 * validates. PATH here is the login-shell-corrected one fixPath() resolved at
 * boot, so version-manager installs (nvm, mise, volta, brew) are visible.
 *
 * Our own shim dirs are skipped, which also guarantees a detected node stays
 * reachable after codex strips shim dirs from its children's PATH.
 *
 * Never throws; any failure just means the Electron fallback stays.
 */
export async function findRealNode(
  options: FindRealNodeOptions = {},
): Promise<RealNode | null> {
  const env = options.env ?? process.env;
  const execPath = options.execPath ?? process.execPath;
  const platform = options.platform ?? process.platform;
  const probe =
    options.probe ??
    ((candidatePath: string) =>
      probeCandidate(
        candidatePath,
        env,
        options.probeTimeoutMs ?? PROBE_TIMEOUT_MS,
      ));

  const override = env.POSTHOG_CODE_NODE_PATH;
  if (override) {
    const result = await probe(override);
    if (!result) {
      options.warn?.(
        "POSTHOG_CODE_NODE_PATH did not validate as a usable real node; keeping the Electron fallback",
        { override },
      );
    }
    return result;
  }

  const binName = platform === "win32" ? "node.exe" : "node";
  let probed = 0;
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, binName);
    if (!isUsableCandidate(candidate, execPath, platform)) continue;
    if (probed >= MAX_PROBED_CANDIDATES) return null;
    probed++;
    const result = await probe(candidate);
    if (result) return result;
  }
  return null;
}

function isUsableCandidate(
  candidatePath: string,
  execPath: string,
  platform: NodeJS.Platform,
): boolean {
  let isSymlink: boolean;
  let size: number;
  try {
    const stat = lstatSync(candidatePath);
    isSymlink = stat.isSymbolicLink();
    size = stat.size;
  } catch {
    return false;
  }

  if (isSymlink) {
    // Legacy shims were symlinks to the app binary; realpath also catches
    // indirect chains. A dangling symlink throws and is skipped.
    try {
      if (realpathSync(candidatePath) === execPath) return false;
    } catch {
      return false;
    }
  } else if (size <= MAX_SHIM_SCRIPT_BYTES) {
    try {
      if (isNodeShimScript(readFileSync(candidatePath, "utf-8"), execPath)) {
        return false;
      }
    } catch {
      return false;
    }
  }

  if (platform !== "win32") {
    try {
      accessSync(candidatePath, constants.X_OK);
    } catch {
      return false;
    }
  }
  return true;
}

async function probeCandidate(
  candidatePath: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<RealNode | null> {
  let stdout: string;
  try {
    // ELECTRON_RUN_AS_NODE=1 in the probe env keeps a stray Electron binary
    // from booting its app: it runs as node and identifies itself through
    // process.versions.electron instead. The timeout + SIGKILL is the
    // backstop for binaries that ignore the variable entirely.
    ({ stdout } = await execFileAsync(candidatePath, ["-p", PROBE_EXPRESSION], {
      env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      windowsHide: true,
      maxBuffer: 64 * 1024,
    }));
  } catch {
    return null;
  }

  // Version-manager wrappers can print warnings before the JSON line.
  const lastLine = stdout.trim().split("\n").pop() ?? "";
  let parsed: { node?: unknown; electron?: unknown };
  try {
    parsed = JSON.parse(lastLine);
  } catch {
    return null;
  }
  if (typeof parsed.node !== "string" || parsed.electron != null) return null;

  const major = Number(/^v(\d+)\./.exec(parsed.node)?.[1]);
  if (!Number.isFinite(major) || major < MIN_REAL_NODE_MAJOR) return null;

  return { path: candidatePath, version: parsed.node };
}

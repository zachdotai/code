import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveRtkPrefix } from "../adapters/claude/session/rtk";

const execFileAsync = promisify(execFile);

/**
 * Where the desktop build stages the bundled rtk binary, relative to the
 * Electron app root — written by copyRtkBinary in apps/code/vite-main-plugins.mts
 * and read back through IBundledResources at runtime.
 */
export const BUNDLED_RTK_DIR = ".vite/build/rtk";

export function bundledRtkBinName(
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32" ? "rtk.exe" : "rtk";
}

/**
 * The `summary` block of `rtk gain --format json` — RTK's own tally of the
 * output it compressed away before it reached the model. The counts are RTK's
 * token estimates (its own output labels them "Input/Output tokens" and "Tokens
 * saved"), not raw bytes.
 */
export interface RtkSavingsSummary {
  totalCommands: number;
  inputTokens: number;
  outputTokens: number;
  tokensSaved: number;
}

interface ResolveRtkSavingsOptions {
  env?: NodeJS.ProcessEnv;
  /** Resolves the rtk binary to invoke; undefined disables reporting. Overridable for tests. */
  resolveBinary?: (env: NodeJS.ProcessEnv) => string | undefined;
  /** Runs `rtk gain` and returns its stdout; overridable for tests. */
  runGain?: (binary: string, env: NodeJS.ProcessEnv) => Promise<string>;
}

function toFiniteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseGainSummary(stdout: string): RtkSavingsSummary | null {
  const parsed: unknown = JSON.parse(stdout); // throws on malformed JSON; caught by caller
  // `JSON.parse("null")` returns null; a bare number or string has no summary field.
  if (!parsed || typeof parsed !== "object") return null;
  const summary = (parsed as { summary?: Record<string, unknown> }).summary;
  if (!summary || typeof summary !== "object") return null;
  return {
    totalCommands: toFiniteNumber(summary.total_commands),
    inputTokens: toFiniteNumber(summary.total_input),
    outputTokens: toFiniteNumber(summary.total_output),
    tokensSaved: toFiniteNumber(summary.total_saved),
  };
}

async function defaultRunGain(
  binary: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const { stdout } = await execFileAsync(binary, ["gain", "--format", "json"], {
    timeout: 5_000,
    // The daily array grows on long-lived hosts; cap the buffer explicitly so
    // ERR_CHILD_PROCESS_STDIO_MAXBUFFER never silently swallows savings on desktop reuse.
    maxBuffer: 10 * 1024 * 1024,
    env: scrubbedGainEnv(env),
  });
  return stdout;
}

// `rtk gain` only reads rtk's own stats database. Don't hand a third-party
// binary the full process env (API keys, tokens) when all it needs is enough
// to locate its data dir and spawn on each platform.
const GAIN_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SystemRoot",
];

export function scrubbedGainEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    GAIN_ENV_ALLOWLIST.filter((key) => env[key] !== undefined).map((key) => [
      key,
      env[key],
    ]),
  );
}

/**
 * Reads RTK's own token-savings tally (`rtk gain --format json`).
 *
 * Best-effort: returns null when RTK is disabled or unavailable, when it has
 * tracked nothing, or on any exec/parse failure — reporting savings must never
 * disrupt a run. The tally is a machine-global cumulative counter shared by
 * every session using the same rtk database — treat a reading as a gauge
 * snapshot to be differenced downstream, not a per-run delta (see
 * emitRtkSavings in agent-server.ts for the consumption contract).
 */
export async function resolveRtkSavings({
  env = process.env,
  resolveBinary = resolveRtkPrefix,
  runGain = defaultRunGain,
}: ResolveRtkSavingsOptions = {}): Promise<RtkSavingsSummary | null> {
  const binary = resolveBinary(env);
  if (!binary) return null;

  try {
    const stdout = await runGain(binary, env);
    const summary = parseGainSummary(stdout);
    // No rtk-wrapped commands ran this session — nothing worth reporting.
    if (!summary || summary.totalCommands <= 0) return null;
    return summary;
  } catch {
    return null;
  }
}

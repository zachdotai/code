import * as vm from "node:vm";
import type { ToolsProxy } from "./proxy";

export interface RunScriptOptions {
  script: string;
  tools: ToolsProxy;
  /** Wall-clock budget for the whole script. Default 30s, capped at 120s. */
  timeoutMs?: number;
}

export interface RunScriptResult {
  /** The script's returned/last-evaluated value, JSON-safe. */
  result: unknown;
  /** Lines captured from `console.*` during the run. */
  logs: string[];
  /** Present only when the script threw or timed out. */
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

/**
 * Runs agent-authored JavaScript in a constrained `node:vm` context with the
 * `tools` proxy injected. The sandbox boundary:
 *
 * - Globals are an explicit allowlist (`tools`, captured `console`, timers,
 *   JSON, Math, Date, encoders, structured-data constructors). There is no
 *   `require`, `import`, `process`, `global`, `Buffer`, `fetch`, or filesystem —
 *   so a script reaches the outside world ONLY through `tools.*`.
 * - A wall-clock timeout aborts a runaway script. `node:vm` cannot interrupt a
 *   pending Promise (e.g. a never-resolving tool call), so the timeout races the
 *   script's completion; it bounds total time even if async work is still
 *   in flight.
 *
 * `node:vm` is not a security sandbox against a determined attacker sharing the
 * process (prototype-chain escapes exist), but here the script author is the
 * same agent that already runs tools directly — the goal is to remove ambient
 * authority (fs/net/env) and force all side effects through the audited `tools`
 * path, not to contain hostile code. For stronger isolation, run the agent
 * itself in its sandbox (which cloud runs already do).
 */
export async function runScript(
  options: RunScriptOptions,
): Promise<RunScriptResult> {
  const timeoutMs = Math.min(
    Math.max(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1),
    MAX_TIMEOUT_MS,
  );
  const logs: string[] = [];
  const sandboxConsole = makeCapturingConsole(logs);

  const context = vm.createContext(
    Object.assign(Object.create(null), {
      tools: options.tools,
      console: sandboxConsole,
      // Pure, stateless helpers — no ambient authority granted by these.
      JSON,
      Math,
      Date,
      Promise,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Map,
      Set,
      RegExp,
      Error,
      TypeError,
      RangeError,
      Symbol,
      BigInt,
      structuredClone,
      TextEncoder,
      TextDecoder,
      URL,
      URLSearchParams,
      setTimeout,
      clearTimeout,
    }),
    { name: "mcp-script", codeGeneration: { strings: false, wasm: false } },
  );

  // Wrap as an async IIFE so the script may use top-level await and `return`.
  const wrapped = `(async () => {\n${options.script}\n})()`;

  let script: vm.Script;
  try {
    script = new vm.Script(wrapped, { filename: "mcp-script.js" });
  } catch (err) {
    return { result: undefined, logs, error: formatError(err) };
  }

  // A single wall-clock deadline governs the whole run. The synchronous
  // `runInContext` phase and the async tool-call phase draw from the same
  // budget: the sync `timeout` is capped at the time left, and the async race
  // keys off the same absolute deadline. Without this, the two phases would be
  // independent and a sync-then-async script could run for nearly 2× timeoutMs.
  const deadline = Date.now() + timeoutMs;

  const run = (async (): Promise<unknown> => {
    const syncBudget = Math.max(deadline - Date.now(), 1);
    // `timeout` here guards synchronous spin; async work is bounded by the race.
    const completion = script.runInContext(context, { timeout: syncBudget });
    return await completion;
  })();

  try {
    const result = await withDeadline(run, deadline, timeoutMs);
    return { result: toJsonSafe(result), logs };
  } catch (err) {
    return { result: undefined, logs, error: formatError(err) };
  }
}

function withDeadline<T>(
  promise: Promise<T>,
  deadline: number,
  budgetMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const remaining = Math.max(deadline - Date.now(), 0);
    const timer = setTimeout(() => {
      reject(new Error(`Script timed out after ${budgetMs}ms`));
    }, remaining);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function makeCapturingConsole(logs: string[]): Console {
  const record = (...args: unknown[]): void => {
    logs.push(args.map(formatLogArg).join(" "));
  };
  // Only log-shaped methods are wired; everything else is a no-op so a script
  // calling e.g. console.table doesn't throw.
  return new Proxy({} as Console, {
    get(_target, prop): unknown {
      if (
        prop === "log" ||
        prop === "info" ||
        prop === "warn" ||
        prop === "error" ||
        prop === "debug"
      ) {
        return record;
      }
      return () => {};
    },
  });
}

function formatLogArg(arg: unknown): string {
  if (typeof arg === "string") {
    return arg;
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

/** Ensures the returned value survives the JSON round-trip the tool result uses. */
function toJsonSafe(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

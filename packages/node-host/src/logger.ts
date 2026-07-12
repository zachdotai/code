import { format } from "node:util";
import type { RootLogger, ScopedLogger } from "@posthog/di/logger";

/**
 * Stdout/stderr logger for the utilityProcess. The supervisor in main pipes
 * this process's stdio into the app log under a node-host scope, so plain
 * prefixed lines are enough here.
 */
export function createStdoutLogger(): RootLogger {
  const write = (
    stream: NodeJS.WriteStream,
    level: string,
    name: string | undefined,
    args: unknown[],
  ) => {
    const scope = name ? `[${name}] ` : "";
    stream.write(`[node-host] ${level} ${scope}${format(...args)}\n`);
  };

  const scoped = (name?: string): ScopedLogger => ({
    debug: (...args) => write(process.stdout, "debug", name, args),
    info: (...args) => write(process.stdout, "info", name, args),
    warn: (...args) => write(process.stderr, "warn", name, args),
    error: (...args) => write(process.stderr, "error", name, args),
  });

  return {
    ...scoped(),
    scope: (name: string) => scoped(name),
  };
}

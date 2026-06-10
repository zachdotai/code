import type { RootLogger, ScopedLogger } from "@posthog/di/logger";

// Module-level logger facade for RTS code that predates DI logging. The host
// calls setRtsRootLogger() during composition; scopes created before that
// lazily resolve on first use, so module-level `logger.scope(...)` is safe.

let root: RootLogger | null = null;

export function setRtsRootLogger(rootLogger: RootLogger): void {
  root = rootLogger;
}

function lazyScope(name: string): ScopedLogger {
  return {
    debug: (...args: unknown[]) => root?.scope(name).debug(...args),
    info: (...args: unknown[]) => root?.scope(name).info(...args),
    warn: (...args: unknown[]) => root?.scope(name).warn(...args),
    error: (...args: unknown[]) => root?.scope(name).error(...args),
  };
}

export const logger = {
  scope: lazyScope,
};

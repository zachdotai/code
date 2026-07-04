import type { UsageOutput } from "./schemas";

export const USAGE_MONITOR_SERVICE = Symbol.for(
  "posthog.core.usageMonitorService",
);
export const USAGE_HOST = Symbol.for("posthog.core.usageHost");

export interface UsageHost {
  fetchUsage(): Promise<UsageOutput>;

  onLlmActivity(listener: () => void): void;
  offLlmActivity(listener: () => void): void;
  hasActiveSessions(): boolean;

  getThresholdsSeen(): Record<string, string>;
  setThresholdsSeen(value: Record<string, string>): void;
}

export interface UsageLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export const RTK_SAVINGS_REPORTER_SERVICE = Symbol.for(
  "posthog.core.rtkSavingsReporterService",
);
export const RTK_SAVINGS_HOST = Symbol.for("posthog.core.rtkSavingsHost");

/**
 * A snapshot of rtk's cumulative token-savings counter. `counterId` identifies
 * the rtk database the reading came from (stable per install), so consumers
 * can difference readings per counter instead of summing them.
 */
export interface RtkSavingsGauge {
  counterId: string;
  totalCommands: number;
  inputTokens: number;
  outputTokens: number;
  tokensSaved: number;
}

export interface RtkSavingsHost {
  /** Reads the gauge, or null when rtk is unavailable or has tracked nothing. */
  readGauge(): Promise<RtkSavingsGauge | null>;
}

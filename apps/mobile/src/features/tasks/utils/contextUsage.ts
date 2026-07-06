import type { SessionEvent } from "../types";

export interface ContextUsage {
  used: number;
  cost: { amount: number; currency: string } | null;
}

/**
 * Most recent context-usage aggregate reported by the agent, or null when the
 * session has emitted no `usage_update` yet.
 */
export function extractContextUsage(
  events: SessionEvent[],
): ContextUsage | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type !== "session_update") continue;
    const update = event.notification.update;
    if (
      update?.sessionUpdate === "usage_update" &&
      typeof update.used === "number"
    ) {
      return { used: update.used, cost: update.cost ?? null };
    }
  }
  return null;
}

/**
 * Most recent (maximum) `ts` among events, or null for an empty list. Scans for
 * the max rather than trusting order, and loops rather than spreading into
 * `Math.max` (which overflows the stack on long lists). A heuristic proxy for
 * prompt-cache freshness, not a billing signal.
 */
export function extractLastActivityAt(events: SessionEvent[]): number | null {
  if (events.length === 0) return null;
  let latest = events[0].ts;
  for (let i = 1; i < events.length; i++) {
    if (events[i].ts > latest) latest = events[i].ts;
  }
  return latest;
}

export interface StaleCostlyThreshold {
  tokens: number;
  staleMs: number;
}

export const DEFAULT_STALE_COSTLY_THRESHOLD: StaleCostlyThreshold = {
  tokens: 100_000,
  // 60min is the long bound of Anthropic's prompt-cache TTL: we deliberately
  // err toward not warning while the cache may still be warm, since nagging
  // about a continuation that is in fact cheap is the worse failure.
  staleMs: 60 * 60 * 1000,
};

/**
 * True when continuing a conversation is likely costly: it is both large
 * (>= `threshold.tokens`) and stale (idle >= `threshold.staleMs`). Pure and
 * time-injected — a null `lastActivityAt` never warns, and a future timestamp
 * (clock skew) reads as fresh.
 */
export function shouldWarnStaleCostlyConversation(args: {
  usedTokens: number;
  lastActivityAt: number | null;
  now: number;
  threshold?: StaleCostlyThreshold;
}): boolean {
  const { usedTokens, lastActivityAt, now } = args;
  const threshold = args.threshold ?? DEFAULT_STALE_COSTLY_THRESHOLD;
  if (lastActivityAt === null) return false;
  if (usedTokens < threshold.tokens) return false;
  return now - lastActivityAt >= threshold.staleMs;
}

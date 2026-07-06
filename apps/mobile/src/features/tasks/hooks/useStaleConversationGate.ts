import { useCallback, useEffect, useMemo } from "react";
import { useUserQuery } from "@/features/auth";
import { useStaleConversationGateStore } from "../stores/staleConversationGateStore";
import type { SessionEvent } from "../types";
import {
  extractContextUsage,
  extractLastActivityAt,
  shouldWarnStaleCostlyConversation,
} from "../utils/contextUsage";

export interface StaleConversationGate {
  /** Gate engaged — block the composer until the user chooses. */
  active: boolean;
  usedTokens: number;
  /** Last activity as observed when the gate engaged, not the live value. */
  lastActivityAt: number | null;
  costUsd: number | null;
  /** "Continue anyway" — permanently acknowledge the warning for this task. */
  onContinue: () => void;
}

/**
 * Gates continuation of a large, idle conversation for PostHog staff, whose
 * prompt cache has likely expired (see {@link shouldWarnStaleCostlyConversation}).
 *
 * The gate latches: opening a stale task reconnects the agent, which
 * immediately emits freshly-stamped events, so the raw staleness check flips
 * back off before the user sees the warning. Once engaged, only acknowledging
 * releases it.
 */
export function useStaleConversationGate(
  taskId: string | undefined,
  events: SessionEvent[],
): StaleConversationGate {
  const { data: currentUser } = useUserQuery();
  const isStaff = currentUser?.is_staff === true;

  const engaged = useStaleConversationGateStore((s) =>
    taskId ? s.engagedSessions.has(taskId) : false,
  );
  const engagedLastActivityAt = useStaleConversationGateStore((s) =>
    taskId ? s.engagedSessions.get(taskId) : undefined,
  );
  const acknowledged = useStaleConversationGateStore((s) =>
    taskId ? s.acknowledgedSessions.has(taskId) : false,
  );
  const engage = useStaleConversationGateStore((s) => s.engage);
  const acknowledge = useStaleConversationGateStore((s) => s.acknowledge);

  const { usage, lastActivityAt } = useMemo(
    () => ({
      usage: extractContextUsage(events),
      lastActivityAt: extractLastActivityAt(events),
    }),
    [events],
  );
  const usedTokens = usage?.used ?? 0;

  // `!engaged` short-circuits the staleness re-check once the gate has latched.
  const shouldEngage =
    !!taskId &&
    isStaff &&
    !acknowledged &&
    !engaged &&
    shouldWarnStaleCostlyConversation({
      usedTokens,
      lastActivityAt,
      now: Date.now(),
    });

  useEffect(() => {
    if (taskId && shouldEngage) engage(taskId, lastActivityAt);
  }, [shouldEngage, engage, taskId, lastActivityAt]);

  const onContinue = useCallback(() => {
    if (taskId) acknowledge(taskId);
  }, [acknowledge, taskId]);

  return {
    // shouldEngage covers the first paint before the effect latches; engaged
    // covers every render after (reconnect events flip shouldEngage back off).
    active: shouldEngage || engaged,
    usedTokens,
    lastActivityAt: engaged ? (engagedLastActivityAt ?? null) : lastActivityAt,
    costUsd: usage?.cost?.amount ?? null,
    onContinue,
  };
}

import { useSessionStore } from "@features/sessions/stores/sessionStore";
import { useMemo } from "react";
import { extractLatestPlanFilePath } from "../utils/planFilePath";

/**
 * Returns the most recently written `.claude/plans/*.md` file path for the
 * given task, or `null` if the agent hasn't produced a plan in this session.
 *
 * The plan file path is derived from the session's event log rather than
 * stored explicitly — this avoids round-tripping a new field through the
 * agent → tRPC → store chain.
 */
export function usePlanFilePath(taskId: string): string | null {
  const events = useSessionStore((state) => {
    const taskRunId = state.taskIdIndex[taskId];
    if (!taskRunId) return null;
    return state.sessions[taskRunId]?.events ?? null;
  });

  return useMemo(
    () => (events ? extractLatestPlanFilePath(events) : null),
    [events],
  );
}

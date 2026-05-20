import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import { sessionStoreSetters } from "@features/sessions/stores/sessionStore";
import { sendPromptToAgent } from "@features/sessions/utils/sendPromptToAgent";
import type { RebaseChildEventPayload } from "@main/services/rts/schemas";
import { trpcClient, useTRPC } from "@renderer/trpc";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import { useSubscription } from "@trpc/tanstack-react-query";
import { track } from "@utils/analytics";
import { logger } from "@utils/logger";
import { useCallback, useEffect, useRef } from "react";

const log = logger.scope("rts-pr-graph-router");

/**
 * Slice 8 — receives `rebaseChild` events from `PrGraphService` and routes
 * each one based on the originating child hoglet's session state:
 *
 * - **Connected, idle session**: call `sendPromptToAgent` with the rebase
 *   prompt — same channel as Slice 7's feedback routing.
 * - **Connected, but mid-stream**: skip injection (avoids clobbering an
 *   in-flight turn) and fall through to the follow-up-spawn path.
 * - **Closed/disconnected**: call `nests.spawnFollowUpHoglet`, which creates
 *   a new cloud Task in the same nest with a `follow_up` edge linking it to
 *   the child.
 * - **No nest**: shouldn't happen (edges require a nest); record as
 *   `failed`.
 *
 * After each outcome, calls `prGraph.recordRebaseOutcome` so main can write
 * the edge state transition and an audit row.
 *
 * Mirrors `useRtsPromptRouter` exactly. Mounted once at app level in
 * `MainLayout.tsx`.
 */
export function useRtsPrGraphRouter() {
  const trpcReact = useTRPC();
  const isAuthenticated = useAuthStateValue(
    (s) => s.status === "authenticated",
  );
  const pendingDrainedRef = useRef(false);

  const handleRebase = useCallback(async (payload: RebaseChildEventPayload) => {
    try {
      const session = sessionStoreSetters.getSessionByTaskId(
        payload.childTaskId,
      );
      const isLive = session?.status === "connected";
      const isStreaming = Boolean(session?.isPromptPending);

      if (isLive && !isStreaming) {
        sendPromptToAgent(payload.childTaskId, payload.prompt);
        await trpcClient.rts.prGraph.recordRebaseOutcome.mutate({
          edgeId: payload.edgeId,
          outcome: "injected",
        });
        track(ANALYTICS_EVENTS.RTS_PR_GRAPH_REBASE, {
          outcome: "injected",
        });
        return;
      }

      if (payload.nestId) {
        await trpcClient.rts.nests.spawnFollowUpHoglet.mutate({
          nestId: payload.nestId,
          parentTaskId: payload.childTaskId,
          prompt: payload.fallbackPrompt,
          payloadRef: `rebase:${payload.edgeId}`,
        });
        await trpcClient.rts.prGraph.recordRebaseOutcome.mutate({
          edgeId: payload.edgeId,
          outcome: "follow_up_spawned",
        });
        track(ANALYTICS_EVENTS.RTS_PR_GRAPH_REBASE, {
          outcome: "follow_up_spawned",
        });
        return;
      }

      await trpcClient.rts.prGraph.recordRebaseOutcome.mutate({
        edgeId: payload.edgeId,
        outcome: "failed",
      });
      track(ANALYTICS_EVENTS.RTS_PR_GRAPH_REBASE, {
        outcome: "failed",
      });
    } catch (error) {
      log.error("Failed to route rebaseChild event", {
        edgeId: payload.edgeId,
        childTaskId: payload.childTaskId,
        error,
      });
      try {
        await trpcClient.rts.prGraph.recordRebaseOutcome.mutate({
          edgeId: payload.edgeId,
          outcome: "broken",
          note: error instanceof Error ? error.message : String(error),
        });
        track(ANALYTICS_EVENTS.RTS_PR_GRAPH_REBASE, {
          outcome: "broken",
        });
      } catch (recordError) {
        log.error("Failed to record rebase broken outcome", {
          edgeId: payload.edgeId,
          recordError,
        });
      }
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      pendingDrainedRef.current = false;
      return;
    }
    if (pendingDrainedRef.current) return;
    pendingDrainedRef.current = true;
    void (async () => {
      try {
        const pending =
          await trpcClient.rts.prGraph.getPendingRebases.query();
        for (const event of pending) {
          await handleRebase(event);
        }
      } catch (error) {
        log.error("Failed to drain pending pr-graph rebase queue", { error });
      }
    })();
  }, [isAuthenticated, handleRebase]);

  useSubscription(
    trpcReact.rts.prGraph.onRebaseChild.subscriptionOptions(undefined, {
      onData: (data) => {
        void handleRebase(data);
      },
    }),
  );
}

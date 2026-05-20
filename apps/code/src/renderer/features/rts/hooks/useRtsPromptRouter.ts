import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import { sessionStoreSetters } from "@features/sessions/stores/sessionStore";
import { sendPromptToAgent } from "@features/sessions/utils/sendPromptToAgent";
import type { InjectPromptEventPayload } from "@main/services/rts/schemas";
import { trpcClient, useTRPC } from "@renderer/trpc";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import { useSubscription } from "@trpc/tanstack-react-query";
import { track } from "@utils/analytics";
import { logger } from "@utils/logger";
import { useCallback, useEffect, useRef } from "react";
import { resolveRtsPromptRoute } from "./promptRouting";

const log = logger.scope("rts-prompt-router");

/**
 * Slice 7 — receives non-hedgehog `injectPrompt` events from
 * `FeedbackRoutingService` and routes each one based on the originating
 * hoglet's session state:
 *
 * - **Connected session**: call the existing `sendPromptToAgent`, same as the
 *   manual "Fix with agent" button.
 * - **Closed/disconnected/completed session (with a nest)**: call
 *   `nests.spawnFollowUpHoglet`, which creates a new cloud Task in the same
 *   nest and links it via `hedgemony_pr_dependency.state = "follow_up"`.
 * - **No nest, no live session**: log as `failed` and let the operator
 *   handle it manually.
 *
 * Hedgehog-originated messages are injected directly from main into the cloud
 * run. The only hedgehog events that should reach this hook are explicit
 * fallback events for runs that need a follow-up.
 *
 * After each outcome, calls `feedback.recordRouted` so main can write the
 * dedupe row and the activity-feed audit entry. Idempotent on the dedupe
 * index — duplicate events become no-ops.
 *
 * Mirrors `useInboxDeepLink` exactly. Mounted once at app level in
 * `MainLayout.tsx`.
 */
export function useRtsPromptRouter() {
  const trpcReact = useTRPC();
  const isAuthenticated = useAuthStateValue(
    (s) => s.status === "authenticated",
  );
  const pendingDrainedRef = useRef(false);

  const handleInject = useCallback(
    async (payload: InjectPromptEventPayload) => {
      try {
        const session = sessionStoreSetters.getSessionByTaskId(payload.taskId);
        const route = resolveRtsPromptRoute({
          payload,
          sessionStatus: session?.status,
        });

        const trustTier =
          payload.source === "hedgehog" ? ("internal" as const) : undefined;

        if (route === "inject") {
          sendPromptToAgent(payload.taskId, payload.prompt);
          await trpcClient.rts.feedback.recordRouted.mutate({
            nestId: payload.nestId,
            hogletTaskId: payload.taskId,
            source: payload.source,
            payloadHash: payload.payloadHash,
            payloadRef: payload.payloadRef,
            routedOutcome: "injected",
            trustTier,
          });
          if (payload.source === "pr_review" || payload.source === "ci") {
            track(ANALYTICS_EVENTS.RTS_FEEDBACK_ROUTED, {
              source: payload.source,
              outcome: "injected",
            });
          }
          return;
        }

        if (route === "spawn_follow_up" && payload.nestId) {
          await trpcClient.rts.nests.spawnFollowUpHoglet.mutate({
            nestId: payload.nestId,
            parentTaskId: payload.taskId,
            prompt: payload.fallbackPrompt,
            payloadRef: payload.payloadRef,
          });
          await trpcClient.rts.feedback.recordRouted.mutate({
            nestId: payload.nestId,
            hogletTaskId: payload.taskId,
            source: payload.source,
            payloadHash: payload.payloadHash,
            payloadRef: payload.payloadRef,
            routedOutcome: "follow_up_spawned",
            trustTier,
          });
          if (payload.source === "pr_review" || payload.source === "ci") {
            track(ANALYTICS_EVENTS.RTS_FEEDBACK_ROUTED, {
              source: payload.source,
              outcome: "follow_up_spawned",
            });
          }
          return;
        }

        await trpcClient.rts.feedback.recordRouted.mutate({
          nestId: payload.nestId,
          hogletTaskId: payload.taskId,
          source: payload.source,
          payloadHash: payload.payloadHash,
          payloadRef: payload.payloadRef,
          routedOutcome: "failed",
          trustTier,
        });
        if (payload.source === "pr_review" || payload.source === "ci") {
          track(ANALYTICS_EVENTS.RTS_FEEDBACK_ROUTED, {
            source: payload.source,
            outcome: "failed",
          });
        }
      } catch (error) {
        log.error("Failed to route injectPrompt event", {
          taskId: payload.taskId,
          source: payload.source,
          payloadRef: payload.payloadRef,
          error,
        });
      }
    },
    [],
  );

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
          await trpcClient.rts.feedback.getPendingInjects.query();
        for (const event of pending) {
          await handleInject(event);
        }
      } catch (error) {
        log.error("Failed to drain pending RTS mode inject queue", { error });
      }
    })();
  }, [isAuthenticated, handleInject]);

  useSubscription(
    trpcReact.rts.feedback.onInjectPrompt.subscriptionOptions(undefined, {
      onData: (data) => {
        void handleInject(data);
      },
    }),
  );
}

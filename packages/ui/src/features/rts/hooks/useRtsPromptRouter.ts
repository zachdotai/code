import { useHostTRPC, useHostTRPCClient } from "@posthog/host-router/react";
import type { InjectPromptEventPayload } from "@posthog/host-router/rts-schemas";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { useAuthStateValue } from "@posthog/ui/features/auth/authQueries";
import { sendPromptToAgent } from "@posthog/ui/features/sessions/sendPromptToAgent";
import { sessionStoreSetters } from "@posthog/ui/features/sessions/sessionStore";
import { track } from "@posthog/ui/shell/analytics";
import { logger } from "@posthog/ui/shell/logger";
import { useSubscription } from "@trpc/tanstack-react-query";
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
 *   nest and links it via `rts_pr_dependency.state = "follow_up"`.
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
  const trpcReact = useHostTRPC();
  const hostClient = useHostTRPCClient();
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
          await hostClient.rts.feedback.recordRouted.mutate({
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
          await hostClient.rts.nests.spawnFollowUpHoglet.mutate({
            nestId: payload.nestId,
            parentTaskId: payload.taskId,
            prompt: payload.fallbackPrompt,
            payloadRef: payload.payloadRef,
          });
          await hostClient.rts.feedback.recordRouted.mutate({
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

        await hostClient.rts.feedback.recordRouted.mutate({
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
    [hostClient],
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
        const pending = await hostClient.rts.feedback.getPendingInjects.query();
        for (const event of pending) {
          await handleInject(event);
        }
      } catch (error) {
        log.error("Failed to drain pending RTS mode inject queue", { error });
      }
    })();
  }, [isAuthenticated, handleInject, hostClient]);

  useSubscription(
    trpcReact.rts.feedback.onInjectPrompt.subscriptionOptions(undefined, {
      onData: (data) => {
        void handleInject(data);
      },
    }),
  );
}

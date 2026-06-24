import {
  type CanvasTerminalStatus,
  hasCanvasGenerationStarted,
  isCanvasGenerating,
  resolveCanvasGenerationStatus,
} from "@posthog/ui/features/canvas/freeform/canvasGenerationStatus";
import { useCanvasGenerationTrackerStore } from "@posthog/ui/features/canvas/stores/canvasGenerationTrackerStore";
import { useSessionStore } from "@posthog/ui/features/sessions/sessionStore";
import { taskDetailQuery } from "@posthog/ui/features/tasks/queries";
import { toast } from "@posthog/ui/primitives/toast";
import { navigateToChannelDashboard } from "@posthog/ui/router/navigationBridge";
import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";

// Poll cadence for the run status of a tracked generation task. Matches the
// canvas record poll in FreeformCanvasView so the toast and the in-view state
// land together.
const POLL_MS = 4000;

// Surface a finished canvas generation as an application toast with a link back
// to the canvas.
function surfaceCanvasGenerationToast(t: {
  channelId: string;
  dashboardId: string;
  name: string;
  status: CanvasTerminalStatus;
}): void {
  const name = t.name.trim() || "Canvas";
  const action = {
    label: "View canvas",
    onClick: () => navigateToChannelDashboard(t.channelId, t.dashboardId),
  };

  if (t.status === "completed") {
    toast.success(`${name} is ready`, {
      description: "Generation finished.",
      duration: 8000,
      action,
    });
  } else if (t.status === "failed") {
    toast.error(`${name} generation failed`, {
      description: "The agent couldn't finish building this canvas.",
      action,
    });
  }
  // "cancelled" is user-initiated — stay silent.
}

// Watches every canvas generation started in this client (registered in the
// tracker store) and fires a toast — with a link to the canvas — the moment each
// one stops generating. Mounted on the persistent channel layout so it keeps
// watching after the user navigates to another canvas: the whole point is to
// call them back when a backgrounded generation lands.
//
// Completion is read from the same signal the canvas view uses (isCanvasGenerating:
// the live ACP session for local runs, cloudStatus for cloud) rather than the
// dashboard's generationTaskId, which is never cleared for freeform canvases.
export function useCanvasGenerationToasts(): void {
  const tracked = useCanvasGenerationTrackerStore((s) => s.tracked);
  const untrack = useCanvasGenerationTrackerStore((s) => s.untrack);

  const taskIds = useMemo(() => Object.keys(tracked), [tracked]);

  const details = useQueries({
    queries: taskIds.map((id) => ({
      ...taskDetailQuery(id),
      refetchInterval: POLL_MS,
    })),
  });

  // The live ACP sessions — for local runs this, not the run record, is what
  // tells us generation has actually finished.
  const sessions = useSessionStore((s) => s.sessions);
  const taskIdIndex = useSessionStore((s) => s.taskIdIndex);

  // Compute the "still generating?" signal per tracked task each render.
  const states = taskIds.map((id, i) => {
    const runId = taskIdIndex[id];
    const session = runId ? sessions[runId] : undefined;
    const latestRun = details[i]?.data?.latest_run;
    const generating = isCanvasGenerating({
      genTaskId: id,
      genTaskLoading: details[i]?.isLoading ?? false,
      latestRun,
      session,
    });
    return { id, generating, latestRun, session };
  });

  // A stable signature so the transition effect only runs on real changes.
  const sig = states
    .map(
      (s) =>
        `${s.id}:${s.generating ? 1 : 0}:${s.latestRun?.status ?? ""}:${s.session?.status ?? ""}:${s.session?.cloudStatus ?? ""}:${s.session?.isPromptPending ? 1 : 0}`,
    )
    .join("|");

  const statesRef = useRef(states);
  statesRef.current = states;
  // Tasks we've confirmed actually started running — only an armed task can
  // toast on finishing, so the create→connect gap can't fire a false toast.
  const armedRef = useRef<Set<string>>(new Set());
  // Tasks already toasted, so a re-run can never double-fire.
  const toastedRef = useRef<Set<string>>(new Set());

  // biome-ignore lint/correctness/useExhaustiveDependencies: sig is the trigger; states/store are read fresh (states via ref) when it changes.
  useEffect(() => {
    for (const st of statesRef.current) {
      if (
        hasCanvasGenerationStarted({
          latestRun: st.latestRun,
          session: st.session,
        })
      ) {
        armedRef.current.add(st.id);
      }

      // A task only toasts once it has demonstrably run and is no longer
      // generating.
      if (
        !armedRef.current.has(st.id) ||
        st.generating ||
        toastedRef.current.has(st.id)
      ) {
        continue;
      }

      toastedRef.current.add(st.id);
      const entry = useCanvasGenerationTrackerStore.getState().tracked[st.id];
      if (entry) {
        surfaceCanvasGenerationToast({
          channelId: entry.channelId,
          dashboardId: entry.dashboardId,
          name: entry.name,
          status: resolveCanvasGenerationStatus({
            latestRun: st.latestRun,
            session: st.session,
          }),
        });
      }
      // Stop tracking (and polling) this task now that it's done.
      untrack(st.id);
    }
  }, [sig, untrack]);
}

// Renders nothing; exists only to host useCanvasGenerationToasts so the frequent
// session-driven re-renders it subscribes to stay isolated here instead of
// re-rendering whatever layout mounts it.
export function CanvasGenerationToaster(): null {
  useCanvasGenerationToasts();
  return null;
}

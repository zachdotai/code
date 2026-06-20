import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { useDashboard } from "@posthog/ui/features/canvas/hooks/useDashboards";
import { useRefreshDashboard } from "@posthog/ui/features/canvas/hooks/useRefreshDashboard";
import { useCanvasRefreshStore } from "@posthog/ui/features/canvas/stores/canvasRefreshStore";
import { useEffect, useRef, useState } from "react";

function threadIdFor(dashboardId: string): string {
  return `dashboard:${dashboardId}`;
}

// Manual refresh for a data canvas. Freeform canvases reload their sandbox iframe
// (which re-runs the app's `ph.query` calls); legacy json-render canvases re-run
// their stored HogQL. A single button — no polling/settings.
export function DashboardRefreshControl({
  dashboardId,
}: {
  dashboardId: string;
}) {
  const { dashboard } = useDashboard(dashboardId);
  const isFreeform = dashboard?.kind === "freeform";
  const { refresh, isRefreshing } = useRefreshDashboard(dashboardId);
  const bump = useCanvasRefreshStore((s) => s.bump);

  // Brief spin for freeform refreshes (the iframe reload has no async signal we
  // can await here, unlike the json-render mutation's isRefreshing).
  const [spinning, setSpinning] = useState(false);
  const spinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (spinTimer.current) clearTimeout(spinTimer.current);
    },
    [],
  );

  const onClick = () => {
    if (isFreeform) {
      bump(threadIdFor(dashboardId));
      setSpinning(true);
      if (spinTimer.current) clearTimeout(spinTimer.current);
      spinTimer.current = setTimeout(() => setSpinning(false), 600);
    } else {
      void refresh();
    }
  };

  const busy = isFreeform ? spinning : isRefreshing;

  return (
    <Button variant="outline" size="sm" disabled={busy} onClick={onClick}>
      <ArrowClockwiseIcon
        size={14}
        className={busy ? "motion-safe:animate-spin" : undefined}
      />
      Refresh
    </Button>
  );
}

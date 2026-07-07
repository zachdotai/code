import { WebsiteDashboard } from "@posthog/ui/features/canvas/components/WebsiteDashboard";
import { CanvasSkeleton } from "@posthog/ui/router/routeSkeletons";
import { yieldToPaint } from "@posthog/ui/router/yieldToPaint";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/website/$channelId/dashboards/$dashboardId",
)({
  component: DashboardRoute,
  pendingComponent: CanvasSkeleton,
  // Single-frame yield: paint the skeleton before the canvas grid's heavy
  // mount blocks the main thread (see yieldToPaint).
  loader: yieldToPaint,
});

function DashboardRoute() {
  const { dashboardId } = Route.useParams();
  return <WebsiteDashboard dashboardId={dashboardId} />;
}

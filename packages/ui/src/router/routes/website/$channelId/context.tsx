import { WebsiteContext } from "@posthog/ui/features/canvas/components/WebsiteContext";
import { ChannelSkeleton } from "@posthog/ui/router/routeSkeletons";
import { yieldToPaint } from "@posthog/ui/router/yieldToPaint";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/website/$channelId/context")({
  component: ContextRoute,
  pendingComponent: ChannelSkeleton,
  // Single-frame yield so the skeleton paints before the heavy mount (see
  // yieldToPaint).
  loader: yieldToPaint,
});

function ContextRoute() {
  const { channelId } = Route.useParams();
  return <WebsiteContext channelId={channelId} />;
}

import { WebsiteChannelHome } from "@posthog/ui/features/canvas/components/WebsiteChannelHome";
import { ChannelSkeleton } from "@posthog/ui/router/routeSkeletons";
import { yieldToPaint } from "@posthog/ui/router/yieldToPaint";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/website/$channelId/")({
  component: ChannelHomeRoute,
  pendingComponent: ChannelSkeleton,
  // Single-frame yield so the skeleton paints before the heavy mount (see
  // yieldToPaint).
  loader: yieldToPaint,
});

function ChannelHomeRoute() {
  const { channelId } = Route.useParams();
  return <WebsiteChannelHome channelId={channelId} />;
}

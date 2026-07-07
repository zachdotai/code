import { WebsiteChannelHistory } from "@posthog/ui/features/canvas/components/WebsiteChannelHistory";
import { ChannelSkeleton } from "@posthog/ui/router/routeSkeletons";
import { yieldToPaint } from "@posthog/ui/router/yieldToPaint";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/website/$channelId/history")({
  component: ChannelHistoryRoute,
  pendingComponent: ChannelSkeleton,
  // Single-frame yield so the skeleton paints before the heavy mount (see
  // yieldToPaint).
  loader: yieldToPaint,
});

function ChannelHistoryRoute() {
  const { channelId } = Route.useParams();
  return <WebsiteChannelHistory channelId={channelId} />;
}

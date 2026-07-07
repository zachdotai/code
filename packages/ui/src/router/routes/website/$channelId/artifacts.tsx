import { WebsiteChannelArtifacts } from "@posthog/ui/features/canvas/components/WebsiteChannelArtifacts";
import { ChannelSkeleton } from "@posthog/ui/router/routeSkeletons";
import { yieldToPaint } from "@posthog/ui/router/yieldToPaint";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/website/$channelId/artifacts")({
  component: ChannelArtifactsRoute,
  pendingComponent: ChannelSkeleton,
  // Single-frame yield so the skeleton paints before the heavy mount (see
  // yieldToPaint).
  loader: yieldToPaint,
});

function ChannelArtifactsRoute() {
  const { channelId } = Route.useParams();
  return <WebsiteChannelArtifacts channelId={channelId} />;
}

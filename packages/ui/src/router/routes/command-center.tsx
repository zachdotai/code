import { CommandCenterView } from "@posthog/ui/features/command-center/components/CommandCenterView";
import { AppPageSkeleton } from "@posthog/ui/router/routeSkeletons";
import { yieldToPaint } from "@posthog/ui/router/yieldToPaint";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/command-center")({
  component: CommandCenterView,
  pendingComponent: AppPageSkeleton,
  // Single-frame yield so the skeleton paints before the heavy mount (see
  // yieldToPaint).
  loader: yieldToPaint,
});

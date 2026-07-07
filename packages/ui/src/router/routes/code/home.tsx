import { HomeView } from "@posthog/ui/features/home/components/HomeView";
import { AppPageSkeleton } from "@posthog/ui/router/routeSkeletons";
import { yieldToPaint } from "@posthog/ui/router/yieldToPaint";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/code/home")({
  component: HomeView,
  pendingComponent: AppPageSkeleton,
  // Single-frame yield so the skeleton paints before the heavy mount (see
  // yieldToPaint).
  loader: yieldToPaint,
});

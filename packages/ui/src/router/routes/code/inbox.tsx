import { InboxView } from "@posthog/ui/features/inbox/components/InboxView";
import { AppPageSkeleton } from "@posthog/ui/router/routeSkeletons";
import { yieldToPaint } from "@posthog/ui/router/yieldToPaint";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/code/inbox")({
  component: InboxView,
  // Shows only while ENTERING inbox (a fresh match pending its first loader
  // run); navigations between inbox children keep this match in `success` and
  // reload in the background, so no skeleton flash on inner navigation.
  pendingComponent: AppPageSkeleton,
  // Single-frame yield so the skeleton paints before the heavy mount (see
  // yieldToPaint).
  loader: yieldToPaint,
});

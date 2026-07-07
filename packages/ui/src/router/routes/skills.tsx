import { SkillsView } from "@posthog/ui/features/skills/SkillsView";
import { AppPageSkeleton } from "@posthog/ui/router/routeSkeletons";
import { yieldToPaint } from "@posthog/ui/router/yieldToPaint";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/skills")({
  component: SkillsView,
  pendingComponent: AppPageSkeleton,
  // Single-frame yield so the skeleton paints before the heavy mount (see
  // yieldToPaint).
  loader: yieldToPaint,
});

import { AgentBuilderDockLayout } from "@posthog/ui/features/agent-applications/agent-builder/AgentBuilderDockLayout";
import { AppPageSkeleton } from "@posthog/ui/router/routeSkeletons";
import { yieldToPaint } from "@posthog/ui/router/yieldToPaint";
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/code/agents")({
  component: AgentsLayout,
  // Shows only while ENTERING agents (a fresh match pending its first loader
  // run); navigations between agent children keep this match in `success` and
  // reload in the background, so no skeleton flash on inner navigation.
  pendingComponent: AppPageSkeleton,
  // Single-frame yield so the skeleton paints before the heavy mount (see
  // yieldToPaint).
  loader: yieldToPaint,
});

function AgentsLayout() {
  return (
    <AgentBuilderDockLayout>
      <Outlet />
    </AgentBuilderDockLayout>
  );
}

import { RecentTasksView } from "@posthog/ui/features/recent-tasks/RecentTasksView";
import { createFileRoute } from "@tanstack/react-router";

// The cross-channel "Recent tasks" list. A Channels-space route so navigating
// here keeps the channels chrome (rail + channel sidebar).
export const Route = createFileRoute("/website/recent-tasks")({
  component: RecentTasksView,
});

import { RecentTasksView } from "@posthog/ui/features/recent-tasks/RecentTasksView";
import { createFileRoute } from "@tanstack/react-router";

// Channels-space route listing every task across all channels, most recent
// first. Lives under /website so it keeps the channels chrome (rail + sidebar)
// — there is no /code counterpart.
export const Route = createFileRoute("/website/recent-tasks")({
  component: RecentTasksView,
});

import { InboxView } from "@posthog/ui/features/inbox/components/InboxView";
import { createFileRoute } from "@tanstack/react-router";

// Channels-space mirror of /code/inbox. Renders the same shared InboxView; the
// view's internal navigation is space-aware, so staying under /website keeps the
// channels chrome instead of bouncing to the Code view.
export const Route = createFileRoute("/website/inbox")({
  component: InboxView,
});

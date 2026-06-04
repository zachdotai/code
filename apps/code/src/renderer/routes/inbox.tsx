import { InboxView } from "@features/inbox/components/InboxView";
import { createFileRoute } from "@tanstack/react-router";

// Top-level Inbox space: the existing inbox, full-screen via the app rail.
export const Route = createFileRoute("/inbox")({
  component: InboxView,
});

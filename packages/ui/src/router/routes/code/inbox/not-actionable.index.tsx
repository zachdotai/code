import { NotActionableTab } from "@posthog/ui/features/inbox/components/NotActionableTab";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/code/inbox/not-actionable/")({
  component: NotActionableTab,
});

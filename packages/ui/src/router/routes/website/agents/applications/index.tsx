import { AgentApplicationsListView } from "@posthog/ui/features/agent-applications/components/AgentApplicationsListView";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/website/agents/applications/")({
  component: AgentApplicationsListView,
});

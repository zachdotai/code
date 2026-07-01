import { AgentObservabilityPane } from "@posthog/ui/features/agent-applications/components/AgentObservabilityPane";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/website/agents/applications/$idOrSlug/observability",
)({
  component: AgentObservabilityRoute,
});

function AgentObservabilityRoute() {
  const { idOrSlug } = Route.useParams();
  return <AgentObservabilityPane idOrSlug={idOrSlug} />;
}

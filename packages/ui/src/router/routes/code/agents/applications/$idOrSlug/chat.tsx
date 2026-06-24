import { AgentChatPane } from "@posthog/ui/features/agent-applications/components/AgentChatPane";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/code/agents/applications/$idOrSlug/chat",
)({
  component: AgentChatRoute,
});

function AgentChatRoute() {
  const { idOrSlug } = Route.useParams();
  return <AgentChatPane idOrSlug={idOrSlug} />;
}

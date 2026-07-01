import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/website/inbox/agents")({
  component: InboxAgentsRedirect,
});

function InboxAgentsRedirect() {
  return <Navigate to="/website/agents" replace />;
}

import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/website/inbox/")({
  component: InboxIndexRedirect,
});

function InboxIndexRedirect() {
  return <Navigate to="/website/inbox/pulls" replace />;
}

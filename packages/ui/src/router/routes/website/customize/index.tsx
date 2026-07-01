import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/website/customize/")({
  component: CustomizeIndexRedirect,
});

function CustomizeIndexRedirect() {
  return <Navigate to="/website/customize/skills" replace />;
}

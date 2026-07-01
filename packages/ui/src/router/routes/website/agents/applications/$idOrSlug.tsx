import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/website/agents/applications/$idOrSlug")({
  component: Outlet,
});

import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/website/inbox/dismissed")({
  component: Outlet,
});

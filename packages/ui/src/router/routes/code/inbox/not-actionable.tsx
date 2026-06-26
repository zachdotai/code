import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/code/inbox/not-actionable")({
  component: Outlet,
});

import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/website/inbox/runs")({
  component: Outlet,
});

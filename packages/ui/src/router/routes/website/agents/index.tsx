import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/website/agents/")({
  beforeLoad: () => {
    throw redirect({ to: "/website/agents/scouts" });
  },
});

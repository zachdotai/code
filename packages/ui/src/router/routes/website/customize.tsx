import { CustomizeLayout } from "@posthog/ui/features/canvas/components/CustomizeLayout";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/website/customize")({
  component: CustomizeLayout,
});

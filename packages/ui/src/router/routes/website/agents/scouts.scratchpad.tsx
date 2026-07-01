import { ScratchpadView } from "@posthog/ui/features/scouts/components/ScratchpadView";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/website/agents/scouts/scratchpad")({
  component: ScratchpadView,
});

import { McpServersView } from "@posthog/ui/features/mcp-servers/components/McpServersView";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/website/customize/mcp-servers")({
  component: McpServersView,
});

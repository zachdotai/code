import { Tooltip } from "@components/ui/Tooltip";
import { useMcpAppsSidebarStore } from "@features/sessions/stores/mcpAppsSidebarStore";
import { SquaresFour } from "@phosphor-icons/react";
import { Button } from "@posthog/quill";

const ICON_SIZE = 18;

export function McpAppsToggleButton() {
  const open = useMcpAppsSidebarStore((s) => s.open);
  const toggle = useMcpAppsSidebarStore((s) => s.toggle);

  return (
    <Tooltip
      content={open ? "Hide MCP apps" : "Show MCP apps"}
      side="bottom"
      delayDuration={300}
    >
      <Button
        size="icon-sm"
        variant="outline"
        aria-label={open ? "Hide MCP apps sidebar" : "Show MCP apps sidebar"}
        aria-pressed={open}
        onClick={toggle}
        className="no-drag"
      >
        <SquaresFour size={ICON_SIZE} weight="regular" />
      </Button>
    </Tooltip>
  );
}

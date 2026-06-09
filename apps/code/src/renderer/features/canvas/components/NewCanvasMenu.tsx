import { useCanvasTemplates } from "@features/canvas/hooks/useCanvasTemplates";
import { useCreateAndOpenDashboard } from "@features/canvas/hooks/useDashboards";
import { PlusIcon } from "@phosphor-icons/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@posthog/quill";
import { useState } from "react";

// "New canvas" entry point: pick a template (Dashboard, Blank, …) and the chosen
// template's agent context drives how the canvas is built. Falls back to a plain
// create (default template) until the template list loads.
export function NewCanvasMenu({
  channelId,
  variant = "outline",
}: {
  channelId: string | undefined;
  variant?: "outline" | "primary";
}) {
  const [open, setOpen] = useState(false);
  const templates = useCanvasTemplates();
  const createAndOpen = useCreateAndOpenDashboard(channelId);

  const trigger = (
    <Button variant={variant} size="sm" className="no-drag">
      <PlusIcon size={14} />
      New canvas
    </Button>
  );

  if (templates.length === 0) {
    return (
      <Button
        variant={variant}
        size="sm"
        className="no-drag"
        onClick={() => void createAndOpen()}
      >
        <PlusIcon size={14} />
        New canvas
      </Button>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent
        align="end"
        side="bottom"
        sideOffset={4}
        className="w-72"
      >
        {templates.map((t) => (
          <DropdownMenuItem
            key={t.id}
            onClick={() => void createAndOpen({ templateId: t.id })}
            className="flex-col items-start gap-0.5"
          >
            <span className="font-medium text-gray-12">{t.name}</span>
            <span className="whitespace-normal text-pretty text-gray-10 text-xs leading-snug">
              {t.description}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

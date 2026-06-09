import { useCanvasTemplates } from "@features/canvas/hooks/useCanvasTemplates";
import { useCreateAndOpenDashboard } from "@features/canvas/hooks/useDashboards";
import { PlusIcon } from "@phosphor-icons/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
  ItemContent,
  ItemDescription,
  ItemMenuItem,
  ItemTitle,
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
      <DropdownMenuTrigger
        render={(props) => (
          <Button variant={variant} size="sm" className="no-drag" {...props} />
        )}
      >
        <PlusIcon size={14} />
        New canvas
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-auto max-w-2xs"
        align="end"
        sideOffset={4}
      >
        <DropdownMenuGroup>
          {templates.map((t) => (
            <DropdownMenuItem
              key={t.id}
              onClick={() => void createAndOpen({ templateId: t.id })}
              render={
                <ItemMenuItem size="xs" className="w-full">
                  <ItemContent variant="menuItem">
                    <ItemTitle>{t.name}</ItemTitle>
                    <ItemDescription className="leading-tight">
                      {t.description}
                    </ItemDescription>
                  </ItemContent>
                </ItemMenuItem>
              }
            />
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

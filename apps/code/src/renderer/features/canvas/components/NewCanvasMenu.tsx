import { useCanvasTemplates } from "@features/canvas/hooks/useCanvasTemplates";
import { useCreateAndOpenDashboard } from "@features/canvas/hooks/useDashboards";
import { PlusIcon } from "@phosphor-icons/react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
  ItemContent,
  ItemDescription,
  ItemMenuItem,
  ItemTitle,
} from "@posthog/quill";
import { useState } from "react";

// "New canvas" entry point: opens a dialog to pick a template (Dashboard,
// Blank, …); the chosen template's agent context drives how the canvas is
// built. Falls back to a plain create (default template) until templates load.
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={(props) => (
          <Button variant={variant} size="sm" className="no-drag" {...props} />
        )}
      >
        <PlusIcon size={14} />
        New canvas
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="max-w-md">
        {/* No visible title; keep one for screen readers only. */}
        <DialogTitle className="sr-only">New canvas</DialogTitle>
        <div className="flex flex-col gap-1">
          {templates.map((t) => (
            <ItemMenuItem
              key={t.id}
              size="sm"
              className="h-auto w-full"
              onClick={() => {
                setOpen(false);
                void createAndOpen({ templateId: t.id });
              }}
            >
              <ItemContent variant="menuItem">
                <ItemTitle>{t.name}</ItemTitle>
                <ItemDescription className="[text-wrap:initial]">
                  {t.description}
                </ItemDescription>
              </ItemContent>
            </ItemMenuItem>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

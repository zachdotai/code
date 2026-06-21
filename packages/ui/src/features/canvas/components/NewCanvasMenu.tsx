import { PlusIcon } from "@phosphor-icons/react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@posthog/quill";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { useCanvasTemplates } from "@posthog/ui/features/canvas/hooks/useCanvasTemplates";
import { useCreateAndOpenDashboard } from "@posthog/ui/features/canvas/hooks/useDashboards";
import { track } from "@posthog/ui/shell/analytics";
import { useState } from "react";

// Where a canvas create was triggered from, for analytics.
type CreateSurface = "dashboards_grid" | "sidebar";

// Fire the "create" DASHBOARD_ACTION, then create + open the canvas.
function trackAndCreate(
  channelId: string | undefined,
  templateId: string | undefined,
  surface: CreateSurface,
  create: () => void,
) {
  track(ANALYTICS_EVENTS.DASHBOARD_ACTION, {
    action_type: "create",
    surface,
    channel_id: channelId,
    template_id: templateId,
  });
  create();
}

// The list of template options shared by the canvas-create dialogs. Picking a
// template creates + opens the canvas, then calls `onPicked` (e.g. to close the
// surrounding dialog). Renders nothing until templates load.
export function CanvasTemplateList({
  channelId,
  surface,
  onPicked,
}: {
  channelId: string | undefined;
  surface: CreateSurface;
  onPicked?: () => void;
}) {
  const templates = useCanvasTemplates();
  const createAndOpen = useCreateAndOpenDashboard(channelId);

  return (
    <div className="flex flex-col gap-1">
      {templates.map((t) => (
        <Button
          key={t.id}
          variant="default"
          className="h-auto w-full flex-col items-start gap-0.5 whitespace-normal py-3 text-left"
          onClick={() => {
            onPicked?.();
            trackAndCreate(
              channelId,
              t.id,
              surface,
              () => void createAndOpen({ templateId: t.id }),
            );
          }}
        >
          <span className="font-medium">{t.name}</span>
          <span className="font-normal text-muted-foreground/80 text-xs [text-wrap:initial]">
            {t.description}
          </span>
        </Button>
      ))}
    </div>
  );
}

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
        onClick={() =>
          trackAndCreate(
            channelId,
            undefined,
            "dashboards_grid",
            () => void createAndOpen(),
          )
        }
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
        New canvas…
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Choose a template</DialogTitle>
          <DialogDescription>
            This gives the agent context for which guardrails to follow when
            generating UI.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <CanvasTemplateList
            channelId={channelId}
            surface="dashboards_grid"
            onPicked={() => setOpen(false)}
          />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

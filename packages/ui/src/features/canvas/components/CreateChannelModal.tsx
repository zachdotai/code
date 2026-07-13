import { validateChannelName } from "@posthog/core/canvas/channelName";
import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Textarea,
} from "@posthog/quill";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { useChannelMutations } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useGenerateContext } from "@posthog/ui/features/canvas/hooks/useGenerateContext";
import { toast } from "@posthog/ui/primitives/toast";
import { track } from "@posthog/ui/shell/analytics";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

// Matches Slack's "Create a channel" naming constraint.
const MAX_CONTEXT_NAME_LENGTH = 80;

const DESCRIPTION_PLACEHOLDER = "Tell me about what this context will be about";

// When a create attempt creates the context but fails to launch the session, we
// stash the description here so reopening the create dialog restores it instead
// of losing what the user typed. Module-scoped so it survives the dialog (and
// its host) unmounting; consumed and cleared on the next create-dialog open.
let stashedDescription = "";

interface CreateChannelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // When set, the context already exists (e.g. the CONTEXT.md empty state): the
  // name field is skipped and submitting just launches the planning session.
  existingContext?: { channelId: string; channelName: string };
}

// Create-a-context dialog. Asks for a name and a short description of what the
// context is about, then launches a plan-mode session that investigates and
// builds the context's CONTEXT.md with the user. Reused from the CONTEXT.md
// empty state via `existingContext` to describe-and-plan an existing context.
export function CreateChannelModal({
  open,
  onOpenChange,
  existingContext,
}: CreateChannelModalProps) {
  const isDescribeMode = !!existingContext;
  const { createChannel, isCreating } = useChannelMutations();
  const { generate, isStarting } = useGenerateContext();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Reset the fields each time the modal opens so a previous draft never
  // lingers. Adjusted inline during render (prev-prop comparison) rather than in
  // an effect, which would flash a stale value for one commit.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName("");
      // Restore a description stashed by a prior failed launch (create mode
      // only), otherwise start blank. Only create mode consumes the stash — a
      // describe-mode open (e.g. the CONTEXT.md empty state the failed flow
      // lands on) must not wipe a draft it doesn't use.
      setDescription(isDescribeMode ? "" : stashedDescription);
      if (!isDescribeMode) stashedDescription = "";
    }
  }

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const remaining = MAX_CONTEXT_NAME_LENGTH - name.length;
  const nameError = isDescribeMode ? null : validateChannelName(trimmedName);

  const busy = isCreating || isStarting;
  const canSubmit =
    !busy &&
    !!trimmedDescription &&
    (isDescribeMode || (!!trimmedName && !nameError));

  const submit = async () => {
    if (!canSubmit) return;

    // Resolve the target context: an existing one, or create it now. The
    // context must exist before we can seed a session against its id.
    let contextId: string;
    let contextName: string;
    if (existingContext) {
      contextId = existingContext.channelId;
      contextName = existingContext.channelName;
    } else {
      try {
        const channel = await createChannel(trimmedName);
        track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
          action_type: "create",
          surface: "sidebar",
          channel_id: channel.id,
          success: true,
        });
        contextId = channel.id;
        contextName = trimmedName;
      } catch (error) {
        track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
          action_type: "create",
          surface: "sidebar",
          success: false,
        });
        toast.error("Couldn't create context", {
          description: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }

    track(ANALYTICS_EVENTS.CONTEXT_ACTION, {
      action_type: "generate_started",
      channel_id: contextId,
    });
    const task = await generate({
      channelId: contextId,
      channelName: contextName,
      description: trimmedDescription,
    });

    if (!task) {
      // The session failed to start (generate() already toasted the details).
      // In create mode the context was still created — close and drop the user
      // on its home so they can retry from the empty state. Stash the typed
      // description so reopening the create dialog restores it. In describe mode
      // the context already existed; keep the dialog open (state intact) for a
      // clean retry.
      if (!existingContext) {
        stashedDescription = trimmedDescription;
        onOpenChange(false);
        void navigate({
          to: "/website/$channelId",
          params: { channelId: contextId },
        });
      }
      return;
    }

    // Launch succeeded. The feed announcements ("created this context", derived
    // from the channel row; context_md_building, posted by generate against the
    // backend channel) are handled where the channel is known — the dialog just
    // navigates.
    //
    // Land on the context index (its feed), where the announcements and the plan
    // task card show. The user clicks the card to open the session.
    onOpenChange(false);
    void navigate({
      to: "/website/$channelId",
      params: { channelId: contextId },
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-bold">
            {isDescribeMode ? "Build this context" : "Create a context"}
          </DialogTitle>
          <DialogDescription>
            {isDescribeMode
              ? `Describe what ${existingContext.channelName} is about — an agent plans and builds its CONTEXT.md with you.`
              : "Name it and describe what it's about — an agent plans and builds its CONTEXT.md with you."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col [&>div]:flex [&>div]:flex-col [&>div]:gap-4">
          {!isDescribeMode && (
            <Field>
              <FieldLabel htmlFor="context-name">Name</FieldLabel>
              <Input
                id="context-name"
                autoFocus
                value={name}
                placeholder="e.g. mobile"
                maxLength={MAX_CONTEXT_NAME_LENGTH}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submit();
                  }
                }}
              />
              {nameError && <FieldError>{nameError}</FieldError>}
              <FieldDescription className="tabular-nums">
                {remaining} left
              </FieldDescription>
            </Field>
          )}

          <Field>
            <FieldLabel htmlFor="context-description">
              Describe the area of work
            </FieldLabel>
            <Textarea
              id="context-description"
              autoFocus={isDescribeMode}
              rows={4}
              value={description}
              placeholder={DESCRIPTION_PLACEHOLDER}
              disabled={busy}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                // ⌘/Ctrl+Enter submits; a bare Enter stays a newline.
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
            <FieldDescription className="tabular-nums">
              Example: "All code, all pull requests related to the mobile app in
              Posthog/Code"
            </FieldDescription>
          </Field>
        </DialogBody>

        <DialogFooter>
          <DialogClose
            render={
              <Button variant="outline" disabled={busy}>
                Cancel
              </Button>
            }
          />
          <Button
            variant="primary"
            disabled={!canSubmit}
            loading={busy}
            onClick={submit}
          >
            {isDescribeMode ? "Start planning" : "Create & plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

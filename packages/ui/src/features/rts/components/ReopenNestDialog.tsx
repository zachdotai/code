import { useHostTRPC } from "@posthog/host-router/react";
import type { Nest } from "@posthog/host-router/rts-schemas";
import { logger } from "@posthog/ui/shell/logger";
import { AlertDialog, Button, Flex, Text, TextArea } from "@radix-ui/themes";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

const log = logger.scope("reopen-nest-dialog");

interface ReopenNestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nest: Nest;
  onReopened?: (nest: Nest) => void;
}

/**
 * Operator confirmation for the Validated → Active transition. Reopening a
 * validated nest resumes the hedgehog's heartbeat so the operator can drive
 * more work. The optional instructions ride along as an operator command so the
 * reopened tick acts on them instead of immediately re-validating a definition
 * of done that is still satisfied.
 */
export function ReopenNestDialog({
  open,
  onOpenChange,
  nest,
  onReopened,
}: ReopenNestDialogProps) {
  const trpc = useHostTRPC();
  const reopenMutation = useMutation(trpc.rts.nests.reopen.mutationOptions());
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submitting = reopenMutation.isPending;

  const [prevOpen, setPrevOpen] = useState(open);

  // Reset during render (not in an effect) so the reopened dialog never
  // paints last session's values.
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setInstructions("");
      setError(null);
    }
  }

  const handleConfirm = async () => {
    if (submitting) return;
    setError(null);
    try {
      const trimmed = instructions.trim();
      const reopened = await reopenMutation.mutateAsync({
        id: nest.id,
        instructions: trimmed.length > 0 ? trimmed : undefined,
      });
      onReopened?.(reopened);
      onOpenChange(false);
    } catch (e) {
      log.error("Failed to reopen nest", { id: nest.id, error: e });
      setError(e instanceof Error ? e.message : "Failed to reopen nest");
    }
  };

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Content maxWidth="460px">
        <AlertDialog.Title>Reopen nest</AlertDialog.Title>
        <AlertDialog.Description size="2">
          Moves <strong>{nest.name}</strong> back to active so the hedgehog
          resumes ticking. Tell it what's left to do — the goal is already
          validated, so without new direction it may just re-validate.
        </AlertDialog.Description>

        <Flex direction="column" gap="3" mt="4">
          <Flex direction="column" gap="1">
            <Text size="1" weight="medium" color="gray">
              What's left to do? (optional)
            </Text>
            <TextArea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. Clean up the spec-notation references in the open PRs and do a final once-over on the adversarial reviews."
              disabled={submitting}
              rows={4}
            />
          </Flex>

          {error && (
            <Text size="2" color="red">
              {error}
            </Text>
          )}
        </Flex>

        <Flex gap="2" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray" disabled={submitting}>
              Cancel
            </Button>
          </AlertDialog.Cancel>
          <Button
            onClick={handleConfirm}
            disabled={submitting}
            loading={submitting}
          >
            Reopen nest
          </Button>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}

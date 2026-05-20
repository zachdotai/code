import type { Nest } from "@main/services/rts/schemas";
import { AlertDialog, Button, Flex, Text, TextField } from "@radix-ui/themes";
import { trpcClient } from "@renderer/trpc/client";
import { logger } from "@utils/logger";
import { useEffect, useState } from "react";

const log = logger.scope("compact-nest-dialog");

interface CompactNestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nest: Nest;
  onCompacted?: (nest: Nest) => void;
}

/**
 * Operator confirmation for the Validated → Dormant transition. Compacts the
 * nest chat to a bounded summary, then keeps the nest queryable. PR / task
 * handles and the validation audit entry survive the compaction.
 */
export function CompactNestDialog({
  open,
  onOpenChange,
  nest,
  onCompacted,
}: CompactNestDialogProps) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
    }
  }, [open]);

  const handleConfirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const trimmed = reason.trim();
      const compacted = await trpcClient.hedgemony.nests.compact.mutate({
        id: nest.id,
        reason: trimmed.length > 0 ? trimmed : undefined,
      });
      onCompacted?.(compacted);
      onOpenChange(false);
    } catch (e) {
      log.error("Failed to compact nest", { id: nest.id, error: e });
      setError(e instanceof Error ? e.message : "Failed to compact nest");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Content maxWidth="460px">
        <AlertDialog.Title>Compact nest</AlertDialog.Title>
        <AlertDialog.Description size="2">
          Trims the chat for <strong>{nest.name}</strong> down to its validation
          summary. PR/task handles and the goal remain queryable; detail rows
          are deleted. This action is one-way.
        </AlertDialog.Description>

        <Flex direction="column" gap="3" mt="4">
          <Flex direction="column" gap="1">
            <Text size="1" weight="medium" color="gray">
              Reason (optional)
            </Text>
            <TextField.Root
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Wrapping up old context"
              disabled={submitting}
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
            color="gray"
          >
            Compact nest
          </Button>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}

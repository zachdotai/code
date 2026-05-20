import type { Nest } from "@main/services/rts/schemas";
import {
  AlertDialog,
  Button,
  Flex,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { trpcClient } from "@renderer/trpc/client";
import { logger } from "@utils/logger";
import { useEffect, useState } from "react";

const log = logger.scope("mark-validated-dialog");

interface MarkValidatedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nest: Nest;
  /** Pre-fill from observed work. PRs from merged-status hoglets, task IDs from terminated hoglets. */
  defaultSummary: string;
  defaultPrUrls: string[];
  defaultTaskIds: string[];
  onValidated?: (nest: Nest) => void;
}

/**
 * Operator confirmation flow for the Active → Validated transition. Pre-fills
 * a summary from the existing definition-of-done + observed merged work; the
 * operator can edit before confirming. On confirm, calls
 * `rts.nests.markValidated` and emits the resulting nest upstream.
 */
export function MarkValidatedDialog({
  open,
  onOpenChange,
  nest,
  defaultSummary,
  defaultPrUrls,
  defaultTaskIds,
  onValidated,
}: MarkValidatedDialogProps) {
  const [summary, setSummary] = useState(defaultSummary);
  const [caveats, setCaveats] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSummary(defaultSummary);
      setCaveats("");
      setError(null);
    }
  }, [open, defaultSummary]);

  const handleConfirm = async () => {
    if (!summary.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const caveatList = caveats
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const validated = await trpcClient.rts.nests.markValidated.mutate({
        id: nest.id,
        summary: summary.trim(),
        prUrls: defaultPrUrls.length > 0 ? defaultPrUrls : undefined,
        taskIds: defaultTaskIds.length > 0 ? defaultTaskIds : undefined,
        caveats: caveatList.length > 0 ? caveatList : undefined,
      });
      onValidated?.(validated);
      onOpenChange(false);
    } catch (e) {
      log.error("Failed to mark nest validated", { id: nest.id, error: e });
      setError(
        e instanceof Error ? e.message : "Failed to mark nest validated",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Content maxWidth="520px">
        <AlertDialog.Title>Mark nest validated</AlertDialog.Title>
        <AlertDialog.Description size="2">
          Confirms the goal is met for <strong>{nest.name}</strong>. The nest
          stays queryable in full detail; you can compact it later.
        </AlertDialog.Description>

        <Flex direction="column" gap="3" mt="4">
          <Flex direction="column" gap="1">
            <Text size="1" weight="medium" color="gray">
              Summary
            </Text>
            <TextArea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={4}
              disabled={submitting}
            />
          </Flex>

          {defaultPrUrls.length > 0 && (
            <Flex direction="column" gap="1">
              <Text size="1" weight="medium" color="gray">
                PRs ({defaultPrUrls.length})
              </Text>
              <Text size="1" color="gray" className="break-all font-mono">
                {defaultPrUrls.join("\n")}
              </Text>
            </Flex>
          )}

          <Flex direction="column" gap="1">
            <Text size="1" weight="medium" color="gray">
              Caveats (optional, one per line)
            </Text>
            <TextField.Root
              value={caveats}
              onChange={(e) => setCaveats(e.target.value)}
              placeholder="Watch errors for a day"
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
            disabled={!summary.trim() || submitting}
            loading={submitting}
            color="green"
          >
            Mark validated
          </Button>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}

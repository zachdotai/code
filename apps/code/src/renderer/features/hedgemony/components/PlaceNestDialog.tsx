import {
  Button,
  Dialog,
  Flex,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { trpcClient } from "@renderer/trpc/client";
import { logger } from "@utils/logger";
import { useEffect, useState } from "react";
import { useNestStore } from "../stores/nestStore";

const log = logger.scope("place-nest-dialog");

export interface PlaceNestDialogProps {
  open: boolean;
  /** World-space coordinates (already adjusted for pan/zoom). */
  mapX: number;
  mapY: number;
  onClose: () => void;
}

export function PlaceNestDialog({
  open,
  mapX,
  mapY,
  onClose,
}: PlaceNestDialogProps) {
  const [name, setName] = useState("");
  const [goalPrompt, setGoalPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setGoalPrompt("");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const canSubmit = name.trim().length > 0 && goalPrompt.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await trpcClient.hedgemony.nests.create.mutate({
        name: name.trim(),
        goalPrompt: goalPrompt.trim(),
        mapX: Math.round(mapX),
        mapY: Math.round(mapY),
      });
      // Insert locally so the sprite renders immediately and the store's
      // diff effect opens a watch subscription for it.
      useNestStore.getState().upsert(created);
      onClose();
    } catch (e) {
      log.error("Failed to create nest", { error: e });
      setError(e instanceof Error ? e.message : "Failed to create nest");
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Content maxWidth="480px" size="2">
        <Dialog.Title size="3">Place a nest</Dialog.Title>
        <Dialog.Description size="2" color="gray">
          Declare a goal. Hoglets will gather around this nest to work on it.
        </Dialog.Description>

        <Flex direction="column" gap="3" mt="4">
          <div>
            <Text
              as="label"
              htmlFor="nest-name"
              size="2"
              mb="1"
              weight="medium"
              className="block"
            >
              Name
            </Text>
            <TextField.Root
              id="nest-name"
              placeholder="Improve checkout conversion"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              disabled={submitting}
            />
          </div>

          <div>
            <Text
              as="label"
              htmlFor="nest-goal"
              size="2"
              mb="1"
              weight="medium"
              className="block"
            >
              Goal
            </Text>
            <TextArea
              id="nest-goal"
              placeholder="Describe what success looks like. Be specific about the outcome and any constraints."
              value={goalPrompt}
              onChange={(e) => setGoalPrompt(e.target.value)}
              rows={5}
              disabled={submitting}
            />
          </div>

          {error && (
            <Text size="2" color="red">
              {error}
            </Text>
          )}
        </Flex>

        <Flex gap="2" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray" disabled={submitting}>
              Cancel
            </Button>
          </Dialog.Close>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            loading={submitting}
          >
            Place nest
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

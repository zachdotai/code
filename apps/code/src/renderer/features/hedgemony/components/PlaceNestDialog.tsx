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
  onCreated?: (mapX: number, mapY: number) => void;
}

export function PlaceNestDialog({
  open,
  mapX,
  mapY,
  onClose,
  onCreated,
}: PlaceNestDialogProps) {
  const [name, setName] = useState("");
  const [goalPrompt, setGoalPrompt] = useState("");
  const [definitionOfDone, setDefinitionOfDone] = useState("");
  const [simpleMode, setSimpleMode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setGoalPrompt("");
      setDefinitionOfDone("");
      setSimpleMode(false);
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const canSubmit =
    name.trim().length > 0 &&
    goalPrompt.trim().length > 0 &&
    (simpleMode || definitionOfDone.trim().length > 0);

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await trpcClient.hedgemony.nests.create.mutate({
        name: name.trim(),
        goalPrompt: goalPrompt.trim(),
        definitionOfDone: simpleMode ? null : definitionOfDone.trim(),
        mapX: Math.round(mapX),
        mapY: Math.round(mapY),
        creationMode: simpleMode ? "simple" : "guided",
      });
      // Insert locally so the sprite renders immediately and the store's
      // diff effect opens a watch subscription for it.
      useNestStore.getState().upsert(created);
      onCreated?.(created.mapX, created.mapY);
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
        <Dialog.Title size="3">Create a nest</Dialog.Title>
        <Dialog.Description size="2" color="gray">
          Write the goal the hedgehog will use later to judge the work.
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
              placeholder="Describe the objective, useful context, likely scope, and constraints."
              value={goalPrompt}
              onChange={(e) => setGoalPrompt(e.target.value)}
              rows={5}
              disabled={submitting}
            />
          </div>

          {!simpleMode && (
            <div>
              <Text
                as="label"
                htmlFor="nest-definition-of-done"
                size="2"
                mb="1"
                weight="medium"
                className="block"
              >
                Definition of done
              </Text>
              <TextArea
                id="nest-definition-of-done"
                placeholder="List what has to be true before this nest can close."
                value={definitionOfDone}
                onChange={(e) => setDefinitionOfDone(e.target.value)}
                rows={4}
                disabled={submitting}
              />
            </div>
          )}

          <button
            type="button"
            onClick={() => setSimpleMode((value) => !value)}
            className="self-start text-(--accent-11) text-[13px] hover:text-(--accent-12)"
            disabled={submitting}
          >
            {simpleMode
              ? "Switch back to goal-writing flow"
              : "Eject to simple form"}
          </button>

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
            Create nest
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

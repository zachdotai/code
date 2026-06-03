import { Button } from "@components/ui/Button";
import { Hash, X } from "@phosphor-icons/react";
import { Dialog, Flex, IconButton, Text, TextField } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { useDesktopFileSystemMutations } from "../hooks/useDesktopFileSystem";

// Matches Slack's "Create a channel" naming constraint.
const MAX_CHANNEL_NAME_LENGTH = 80;

interface CreateChannelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateChannelModal({
  open,
  onOpenChange,
}: CreateChannelModalProps) {
  const { createChannel, isCreating } = useDesktopFileSystemMutations();
  const [name, setName] = useState("");

  // Reset the field each time the modal opens so a previous draft never lingers.
  useEffect(() => {
    if (open) setName("");
  }, [open]);

  const trimmed = name.trim();
  const remaining = MAX_CHANNEL_NAME_LENGTH - name.length;

  const submit = async () => {
    if (!trimmed) return;
    try {
      await createChannel(trimmed);
      onOpenChange(false);
    } catch {
      // Keep the modal open so the user can retry; the mutation surfaces the error.
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!isCreating) onOpenChange(next);
      }}
    >
      <Dialog.Content maxWidth="560px">
        <Flex align="start" justify="between" gap="3">
          <Dialog.Title>
            <Text className="font-bold text-lg">Create a channel</Text>
          </Dialog.Title>
          <Dialog.Close>
            <IconButton
              variant="ghost"
              color="gray"
              size="2"
              aria-label="Close"
              disabled={isCreating}
            >
              <X size={18} />
            </IconButton>
          </Dialog.Close>
        </Flex>

        <Flex direction="column" gap="2" mt="4">
          <Text
            as="label"
            htmlFor="channel-name"
            className="font-medium text-sm"
          >
            Name
          </Text>
          <TextField.Root
            id="channel-name"
            autoFocus
            size="3"
            value={name}
            placeholder="e.g. plan-budget"
            maxLength={MAX_CHANNEL_NAME_LENGTH}
            disabled={isCreating}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
          >
            <TextField.Slot>
              <Hash size={16} className="text-gray-10" />
            </TextField.Slot>
            <TextField.Slot side="right">
              <Text className="text-gray-9 text-sm tabular-nums">
                {remaining}
              </Text>
            </TextField.Slot>
          </TextField.Root>
          <Text className="text-gray-10 text-sm">
            Channels are where conversations happen around a topic. Use a name
            that is easy to find and understand.
          </Text>
        </Flex>

        <Flex gap="3" mt="5" justify="end">
          <Button
            variant="solid"
            disabled={!trimmed || isCreating}
            disabledReason={!trimmed ? "enter a channel name" : null}
            loading={isCreating}
            onClick={submit}
          >
            Create
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

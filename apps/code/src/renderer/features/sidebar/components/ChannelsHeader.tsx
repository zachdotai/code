import { Plus } from "@phosphor-icons/react";
import { Flex, IconButton, Text } from "@radix-ui/themes";
import { useState } from "react";
import { CreateChannelModal } from "./CreateChannelModal";

// Header above the channel tree with an "add channel" affordance that opens a
// Slack-style create-channel modal.
export function ChannelsHeader() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <Flex direction="column" className="px-2 pb-1">
      <Flex align="center" justify="between" className="h-[22px]">
        <Text className="font-medium text-[11px] text-gray-10 uppercase tracking-wide">
          Channels
        </Text>
        <IconButton
          type="button"
          variant="ghost"
          color="gray"
          size="1"
          aria-label="Create channel"
          onClick={() => setIsModalOpen(true)}
        >
          <Plus size={12} />
        </IconButton>
      </Flex>
      <CreateChannelModal open={isModalOpen} onOpenChange={setIsModalOpen} />
    </Flex>
  );
}
